# CLAUDE.md - Contexto del proyecto Arbitraje Bonos

## Qué es este proyecto

App de arbitraje financiero de bonos argentinos (Globales vs Bonares). Reemplaza un Excel que tenía tablas de relaciones entre bonos (GD30-AL30, GD41-AL41, etc.) con promedios semanales, mensuales, máximos, mínimos, y gráficos con indicadores.

## Stack tecnológico

- **Monorepo** con pnpm workspaces
- **Backend**: Node.js + TypeScript + Fastify + Mongoose + ws
- **Frontend**: React + TypeScript + Vite + TailwindCSS + Recharts/Lightweight Charts
- **Base de datos**: MongoDB
- **Tipos compartidos**: paquete `@arbitraje/shared`

## Arquitectura

```
BYMA (FIX/WS)
      │
      ▼
┌─────────────────────────────────────────┐
│            BACKEND (Node/TS)            │
│                                         │
│  BymaConnector ──▶ MarketDataService    │
│    (WS client)     (Map en RAM por      │
│                     ticker)             │
│                         │               │
│              ┌──────────┼──────────┐    │
│              ▼          ▼          ▼    │
│        AlertEngine  Snapshot    REST    │
│        (evalúa      Service    API     │
│         condiciones  (persiste          │
│         en RT)       cada 10s)          │
│              │          │         │     │
│              ▼          ▼         │     │
│         WS Server   MongoDB ◀────┘     │
│        (push alerts)                    │
└──────────────┼─────────────────────────┘
               ▼
          FRONTEND
```

## Decisiones de diseño clave

### Flujo hot/cold de datos
- **Hot (en memoria)**: todos los ticks viven en un `Map<ticker, TickEntry>` dentro de `MarketDataService`. Cada tick nuevo sobrescribe el anterior. Esto se usa para alertas en tiempo real.
- **Cold (persistencia)**: `SnapshotService` toma una foto cada N segundos (configurable, default 10s) y hace un `bulkWrite` a MongoDB. Así la BD crece a ritmo controlado.

### Event Bus interno
- Todos los servicios se comunican via un `EventEmitter` tipado (`event-bus.ts`).
- Eventos: `tick`, `pair:update`, `alert:triggered`, `snapshot:saved`.
- Esto desacopla los servicios: MarketDataService no sabe que AlertEngine existe.

### Dos conexiones WebSocket
1. **Upstream (BYMA → Backend)**: `BymaConnector` es un WS client con reconexión automática (backoff exponencial). Recibe datos FIX del mercado.
2. **Downstream (Backend → Frontend)**: `WSServer` es un WS server que pushea alertas y actualizaciones de pares al front. El front se suscribe solo a los pares que le interesan.

### Modelo de datos MongoDB
- `ticks`: snapshots crudos cada N segundos (con TTL opcional)
- `bonds`: definición de cada bono (ticker, ley, moneda, vencimiento)
- `bond_pairs`: pares de arbitraje (GD30-AL30, etc.)
- `pair_snapshots`: foto de cada par cada N segundos (ratio, spread, precios)
- `ohlcv`: velas agregadas por timeframe (1m, 5m, 15m, 1h, 4h, 1d)
- `alert_configs`: configuración de alertas

### Datos que ya existen en la BD
El usuario ya tiene un script corriendo que guarda ticks de BYMA en MongoDB con esta estructura:
```json
{
  "ticket": "GD30_24hs",
  "timestamp": "2026-03-30T13:33:12.245Z",
  "data": {
    "num_oper": "110463",
    "prc_comp": "521",        // Precio comprador
    "cant_comp": "88900",     // Cantidad comprador
    "prc_venta": "89250",     // Precio vendedor
    "cant_venta": "5458",     // Cantidad vendedor
    "prc_act": "88900",       // Precio actual
    "time_ult_oper": "...",   // Timestamp última operación
    "vol_inter": "4279599.8", // Volumen intervenido
    "vol_nom": "4809",        // Volumen nominal
    "prc_min": "88950",
    "prc_max": "89160",
    "fecha_ant": "2026-03-27",
    "prc_ant": "88900"        // Cierre anterior
  }
}
```

## Estructura del proyecto

```
arbitraje-bonos/
├── package.json              # Workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── docker-compose.yml        # MongoDB
├── shared/                   # Tipos compartidos (@arbitraje/shared)
│   └── src/
│       ├── index.ts          # Dominio bonos + re-export de opciones
│       └── options.ts        # Dominio opciones (legs, griegas, simulación)
├── packages/
│   ├── backend/
│   │   └── src/
│   │       ├── index.ts              # Entry point, bootea todo (composition root)
│   │       ├── config/index.ts       # ── KERNEL: variables de entorno (Zod)
│   │       ├── utils/                 # ── KERNEL: logger (Pino), session
│   │       └── modules/              # Un subdir por dominio (simétrico)
│   │           ├── bonds/
│   │           │   ├── routes.ts             # REST API de bonos (Fastify)
│   │           │   ├── models.ts             # Mongoose schemas de bonos
│   │           │   ├── ws-server.ts          # WS server al front
│   │           │   ├── services/             # event-bus, market-data, pair-calculator,
│   │           │   │                         #   snapshot, alert-engine, byma-connector, ...
│   │           │   └── scripts/              # seed, backfill-*
│   │           └── options/
│   │               ├── routes.ts             # /api/options/* (simulate, price, iv, chain)
│   │               ├── models.ts             # options_strategies
│   │               ├── pricing.service.ts    # Black-Scholes, griegas, IV
│   │               ├── payoff.service.ts     # Curva P&L, breakevens, max profit/loss
│   │               └── iol-options.connector.ts # Adaptador IOL (OptionsDataProvider)
│   └── frontend/
│       └── src/
│           ├── main.tsx
│           ├── App.tsx                       # Router (rutas de ambas secciones)
│           ├── index.css                     # Tailwind + tema oscuro
│           ├── components/layout/Layout.tsx  # Shell: switch de sección Bonos/Opciones
│           └── features/                    # Un subdir por dominio (simétrico)
│               ├── bonds/
│               │   ├── components/{dashboard,charts,multicharts,settings}/
│               │   ├── services/{api,wsClient,sound}.ts
│               │   └── store/{marketStore,settingsStore}.ts
│               └── options/
│                   ├── SimulatorView.tsx     # Simulador de operatorias
│                   └── optionsApi.ts
```

> **Arquitectura modular**: cada dominio (bonos, opciones) vive aislado bajo
> `modules/` (backend) y `features/` (frontend). El "kernel" compartido es
> `config/` + `utils/` (back) y `components/layout` + `App.tsx` (front). Para
> agregar un dominio nuevo se replica el patrón sin tocar los existentes.

## Comandos

```bash
# Instalar dependencias
pnpm install

# Levantar MongoDB
docker compose up -d

# Copiar y configurar env
cp packages/backend/.env.example packages/backend/.env

# Seed de datos iniciales
pnpm --filter backend seed

# Dev (ambos en paralelo)
pnpm dev

# Solo backend
pnpm dev:backend

# Solo frontend
pnpm dev:frontend
```

## Próximos pasos

1. **Adaptar BymaConnector** al formato real de mensajes FIX que recibe
2. **Vista de gráficos** con Lightweight Charts (candlesticks del ratio + indicadores)
3. **Vista de alertas** con CRUD completo
4. **Vista de configuración** para ABM de pares
5. **Agregación OHLCV** - job que genera velas desde snapshots
6. **Ingesta automática** - integrar el script existente como servicio del backend
7. **Backtesting** de estrategias de arbitraje
