// ============================================================
// Tipos compartidos entre backend y frontend
// ============================================================

// --- Dominio Opciones (simulador, pricing, griegas) ---
export * from "./options.js";

// --- Datos crudos del mercado (lo que viene de BYMA via FIX) ---

export interface RawTickData {
  num_oper: string;
  prc_comp: string; // Precio comprador
  cant_comp: string; // Cantidad comprador
  prc_venta: string; // Precio vendedor
  cant_venta: string; // Cantidad vendedor
  prc_act: string; // Precio actual / último operado
  time_ult_oper: Date; // Timestamp última operación
  vol_inter: string; // Volumen intervenido (monto)
  vol_nom: string; // Volumen nominal
  prc_min: string; // Precio mínimo del día
  prc_max: string; // Precio máximo del día
  fecha_ant: string; // Fecha anterior
  prc_ant: string; // Precio anterior (cierre)
}

export interface TickDocument {
  _id: string;
  ticket: string;
  timestamp: Date;
  data: RawTickData;
}

// --- Acciones argentinas (IOL Cotizaciones) ---
// Snapshot diario de cada acción al cierre de la rueda. Subconjunto de los
// campos que devuelve IOL en /api/v2/Cotizaciones/acciones/argentina/Todos.

export interface ArgStock {
  simbolo: string;
  ultimoPrecio: number;
  variacionPorcentual: number;
  apertura: number;
  maximo: number;
  minimo: number;
  volumen: number;
  cantidadOperaciones: number;
  fecha: Date; // Instante exacto. IOL lo manda en ART (UTC-3) sin offset.
  descripcion: string;
  plazo: string; // Ej: "T1", "CI"
}

// --- Bonos ---

export type BondCurrency = "USD" | "ARS";
export type BondLaw = "NY" | "AR";
export type SettlementType = "CI" | "24hs" | "48hs";

export interface Bond {
  ticker: string; // Ej: "GD30"
  fullTicker: string; // Ej: "GD30_24hs"
  name: string; // Ej: "Global 2030"
  currency: BondCurrency;
  law: BondLaw;
  maturityDate: Date;
  settlement: SettlementType;
}

// --- Pares de arbitraje ---

export type PairType = "ratio" | "spread";

export interface BondPair {
  id: string;
  name: string; // Ej: "GD30-AL30"
  bondA: string; // ticker del bono A (numerador)
  bondB: string; // ticker del bono B (denominador)
  settlementA: SettlementType;
  settlementB: SettlementType;
  type: PairType; // ratio (A/B) o spread (A-B)
  isActive: boolean;
  createdAt: Date;
}

// --- Datos calculados en tiempo real ---

export interface PairLiveData {
  pairId: string;
  pairName: string;
  currentRatio: number;
  priceA: number;
  priceB: number;
  bidA: number;
  askA: number;
  bidB: number;
  askB: number;
  changePercent: number; // Cambio % vs cierre anterior
  timestamp: Date;
}

// --- Fases de la rueda ---
// pre_open: antes de la apertura (subasta / pre-mercado)
// warmup:   primeros N minutos (ignorar en stats)
// regular:  rueda normal (se usa en stats)
// cooldown: últimos N minutos (ignorar en stats; útil para detectar intervenciones)
// post_close: después del cierre
export type SessionPhase =
  | "pre_open"
  | "warmup"
  | "regular"
  | "cooldown"
  | "post_close";

// --- Snapshots (lo que se persiste cada N segundos) ---

export interface PairSnapshot {
  pairId: string;
  timestamp: Date;
  priceA: number;
  priceB: number;
  ratio: number;
  spread: number;
  volumeA: number;
  volumeB: number;
  sessionPhase: SessionPhase;
}

export interface BondSnapshot {
  bondId: string;
  fullTicker: string;
  ticker: string;
  timestamp: Date;
  price: number;
  bid?: number;
  ask?: number;
  volumeNominal: number;
  volumeInter: number;
  raw: RawTickData;
  sessionPhase: SessionPhase;
}

// --- Rollup diario del par (sólo fase 'regular') ---

export interface PairDaily {
  pairId: string;
  pairName: string;
  date: string; // "YYYY-MM-DD" en la timezone del mercado
  high: number;
  low: number;
  close: number;
  vwap: number; // promedio ponderado por volumen del ratio
  // Promedio simple del close de las velas 5m de la rueda (sólo buckets que
  // contengan al menos un snapshot en fase 'regular'). Es el "promedio de
  // precios del día" que usa el cálculo de bandas — distinto al `vwap`
  // (ponderado por volumen) y al `mean` (promedio de todos los snapshots).
  avgClose: number;
  stdDev: number;
  sampleCount: number;
  firstRegularTs: Date;
  lastRegularTs: Date;
}

// Banda dinámica que proyecta una excursión esperada sobre el promedio de
// precios de la rueda anterior (ver routes/index.ts para la fórmula completa).
// Para la fecha D:
//   delta_k     = high(D-k) − avgClose(D-k-1)         // k = 1..window
//   upperBand(D) = avgClose(D-1) + (Σ delta_k) / window
//   (idem con `low` para lowerBand)
// La última fila puede ser sintética (date = hoy aún sin rollup) — en ese
// caso `high`/`low` son null y sólo importan los promedios.
export interface PairDailyBands {
  pairId: string;
  pairName: string;
  window: number; // cantidad de deltas promediados (default 16)
  series: Array<{
    date: string;
    high: number | null;
    low: number | null;
    avgClose: number | null;
    upperBand: number | null;
    lowerBand: number | null;
  }>;
}

// --- OHLCV agregado ---

export type TimeframeKey = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export interface OHLCV {
  pairId: string;
  timeframe: TimeframeKey;
  openTime: Date;
  closeTime: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sampleCount: number; // Cantidad de snapshots que componen esta vela
}

// --- Estadísticas ---

export type StatsWindow = "1w" | "2w" | "1m" | "3m" | "6m" | "1y";

export interface PairStatistics {
  pairId: string;
  pairName: string;
  window: StatsWindow;
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
  currentRatio: number;
  zScore: number; // Cuántos desvíos del promedio está el ratio actual
  percentile: number; // En qué percentil se encuentra
  sampleCount: number;
  calculatedAt: Date;
}

// --- Summary por par (referencias para la tabla) ---
// Calculado a partir de `pair_daily` excluyendo el día corriente.
// `avgPrev` toma `avgClose` de la última rueda; `avg1w`/`avg1m` promedian
// VWAP diario; `min1m`/`max1m` usan `low`/`high` intradiario. Las ventanas
// son por calendario (7/30 días).

export interface PairSummary {
  pairId: string;
  avgPrev: number | null;
  avg1w: number | null;
  avg1m: number | null;
  min1m: number | null;
  max1m: number | null;
  sampleCount1w: number;
  sampleCount1m: number;
  calculatedAt: Date;
}

// --- Alertas ---

export type AlertCondition = "above" | "below" | "cross_above" | "cross_below";
export type AlertStatus = "active" | "triggered" | "disabled";
export type AlertField = "ratio" | "spread" | "priceA" | "priceB";

export interface AlertConfig {
  id: string;
  pairId: string;
  pairName: string;
  field: AlertField;
  condition: AlertCondition;
  threshold: number;
  message?: string;
  status: AlertStatus;
  createdAt: Date;
  triggeredAt?: Date;
}

export interface AlertEvent {
  alertId: string;
  pairId: string;
  pairName: string;
  field: AlertField;
  condition: AlertCondition;
  threshold: number;
  currentValue: number;
  message: string;
  timestamp: Date;
}

// --- WebSocket Messages ---

export type WSMessageType =
  | "tick_update"
  | "pair_update"
  | "alert_triggered"
  | "subscribe"
  | "unsubscribe"
  | "heartbeat";

export interface WSMessage<T = unknown> {
  type: WSMessageType;
  payload: T;
  timestamp: Date;
}

export interface WSSubscribePayload {
  channel: "pairs" | "alerts" | "ticks";
  pairIds?: string[];
}

// --- API Responses ---

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number;
  page: number;
  limit: number;
}

// --- Operaciones de arbitraje (registro manual de trades) ---

export type ExerciseStatus = "open" | "closed";

// "buy_ratio"  = compré el ratio = compré A y vendí B
// "sell_ratio" = vendí el ratio  = vendí A y compré B
export type OperationSide = "buy_ratio" | "sell_ratio";

export interface Exercise {
  id: string;
  pairId: string;
  pairName: string;
  name: string;
  status: ExerciseStatus;
  openedAt: Date;
  closedAt: Date | null;
  openingNotes: string;
  closingNotes: string;
  realizedPnL: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ArbitrageOperation {
  id: string;
  exerciseId: string;
  pairId: string;
  timestamp: Date;
  side: OperationSide;
  nominalsA: number; // positivo = compré A, negativo = vendí A
  priceA: number;
  nominalsB: number; // positivo = compré B, negativo = vendí B
  priceB: number;
  executedRatio: number; // priceA / priceB
  notes: string;
}

// Marca cuándo una operación cerró un ciclo (saldo neto vuelve a 0).
export interface ExerciseCycle {
  closedAtOperationId: string;
  closedAt: Date;
  pnl: number;
}

export interface ExerciseState {
  netNominalsA: number;
  netNominalsB: number;
  realizedPnL: number;
  openCycleCashFlow: number; // cash flow del ciclo aún abierto (0 si está plano)
  cycles: ExerciseCycle[];
}

export interface ExerciseDetail {
  exercise: Exercise;
  operations: ArbitrageOperation[];
  state: ExerciseState;
}

// ============================================================
// App Settings - configuración global persistida en backend
// ============================================================

export type LineStyleType = "solid" | "dashed" | "dotted";

export interface IndicatorLineConfig {
  enabled: boolean;
  color: string;
  width: number;
  style: LineStyleType;
}

export interface SMAConfig extends IndicatorLineConfig {
  period: number;
}

export interface BollingerConfig extends IndicatorLineConfig {
  period: number;
  stdDev: number;
}

export interface DailyBandsConfig {
  enabled: boolean;
  upperColor: string;
  lowerColor: string;
  width: number;
  style: LineStyleType;
}

export interface RatioChartSettings {
  timeframe: TimeframeKey;
  sma: SMAConfig;
  promant: IndicatorLineConfig;
  prommonth: IndicatorLineConfig;
  bollinger: BollingerConfig;
  dailyBands: DailyBandsConfig;
}

export interface AppSettings {
  ratioChart: RatioChartSettings;
  // Orden personalizado de los pares en la tabla (array de pairIds).
  // Los pares no presentes se muestran al final, en su orden natural.
  pairOrder: string[];
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  pairOrder: [],
  ratioChart: {
    timeframe: "5m",
    sma: {
      enabled: true,
      color: "#f97316",
      width: 2,
      style: "solid",
      period: 200,
    },
    promant: {
      enabled: true,
      color: "#02CF28",
      width: 1,
      style: "dashed",
    },
    prommonth: {
      enabled: true,
      color: "#F20202",
      width: 1,
      style: "dashed",
    },
    bollinger: {
      enabled: true,
      color: "#FF0000",
      width: 1,
      style: "solid",
      period: 200,
      stdDev: 2,
    },
    dailyBands: {
      enabled: true,
      upperColor: "#A855F7",
      lowerColor: "#A855F7",
      width: 1,
      style: "solid",
    },
  },
};
