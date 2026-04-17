// ============================================================
// Tipos compartidos entre backend y frontend
// ============================================================

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
  stdDev: number;
  sampleCount: number;
  firstRegularTs: Date;
  lastRegularTs: Date;
}

// Banda "tipo Bollinger" construida con promedios móviles de high/low.
// upper[i] = promedio de `high` en los últimos N días hasta daily[i]
// lower[i] = promedio de `low`  en los últimos N días hasta daily[i]
export interface PairDailyBands {
  pairId: string;
  pairName: string;
  window: number; // ej: 5, 10, 20
  series: Array<{
    date: string;
    high: number;
    low: number;
    close: number;
    upperBand: number | null; // null hasta que haya `window` muestras
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

// --- Alertas ---

export type AlertCondition = "above" | "below" | "cross_above" | "cross_below";
export type AlertStatus = "active" | "triggered" | "disabled";

export interface AlertConfig {
  id: string;
  pairId: string;
  pairName: string;
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
