import mongoose, { Schema, Document } from "mongoose";
import type {
  RawTickData,
  Bond,
  BondPair,
  PairSnapshot,
  BondSnapshot,
  AlertConfig,
  OHLCV,
  PairDaily,
  SessionPhase,
  Exercise,
  ArbitrageOperation,
  RatioChartSettings,
} from "@arbitraje/shared";

const SESSION_PHASES: SessionPhase[] = [
  "pre_open",
  "warmup",
  "regular",
  "cooldown",
  "post_close",
];

// ============================================================
// Tick - datos crudos del mercado (snapshots cada N segundos)
// ============================================================
interface TickDoc extends Document {
  ticket: string;
  timestamp: Date;
  data: RawTickData;
}

const tickSchema = new Schema<TickDoc>(
  {
    ticket: { type: String, required: true, index: true },
    timestamp: { type: Date, required: true, index: true },
    data: {
      num_oper: String,
      prc_comp: String,
      cant_comp: String,
      prc_venta: String,
      cant_venta: String,
      prc_act: String,
      time_ult_oper: Date,
      vol_inter: String,
      vol_nom: String,
      prc_min: String,
      prc_max: String,
      fecha_ant: String,
      prc_ant: String,
    },
  },
  {
    timestamps: false,
    // TTL: los ticks crudos se borran después de 7 días
    // Ajustá este valor según cuánto espacio tengas
    expireAfterSeconds: undefined,
  },
);

// Índice compuesto para queries eficientes
tickSchema.index({ ticket: 1, timestamp: -1 });

export const TickModel = mongoose.model<TickDoc>("Tick", tickSchema, "ticks");

// ============================================================
// Bond - definición de cada bono
// ============================================================
interface BondDoc extends Bond, Document {}

const bondSchema = new Schema<BondDoc>(
  {
    ticker: { type: String, required: true, unique: true },
    fullTicker: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    currency: { type: String, enum: ["USD", "ARS"], required: true },
    law: { type: String, enum: ["NY", "AR"], required: true },
    maturityDate: { type: Date, required: true },
    settlement: { type: String, enum: ["CI", "24hs", "48hs"], required: true },
  },
  { timestamps: true },
);

export const BondModel = mongoose.model<BondDoc>("Bond", bondSchema, "bonds");

// ============================================================
// BondPair - pares de arbitraje
// ============================================================
interface BondPairDoc extends Omit<BondPair, "id">, Document {}

const bondPairSchema = new Schema<BondPairDoc>(
  {
    name: { type: String, required: true, unique: true },
    bondA: { type: String, required: true },
    bondB: { type: String, required: true },
    settlementA: { type: String, enum: ["CI", "24hs", "48hs"], required: true },
    settlementB: { type: String, enum: ["CI", "24hs", "48hs"], required: true },
    type: { type: String, enum: ["ratio", "spread"], default: "ratio" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const BondPairModel = mongoose.model<BondPairDoc>(
  "BondPair",
  bondPairSchema,
  "bond_pairs",
);

// ============================================================
// PairSnapshot - foto del par cada N segundos
// ============================================================
interface PairSnapshotDoc extends PairSnapshot, Document {}

const pairSnapshotSchema = new Schema<PairSnapshotDoc>(
  {
    pairId: { type: String, required: true, index: true },
    timestamp: { type: Date, required: true, index: true },
    priceA: { type: Number, required: true },
    priceB: { type: Number, required: true },
    ratio: { type: Number, required: true },
    spread: { type: Number, required: true },
    volumeA: { type: Number, default: 0 },
    volumeB: { type: Number, default: 0 },
    sessionPhase: {
      type: String,
      enum: SESSION_PHASES,
      required: true,
      index: true,
    },
  },
  { timestamps: false },
);

pairSnapshotSchema.index({ pairId: 1, timestamp: -1 });
pairSnapshotSchema.index({ pairId: 1, sessionPhase: 1, timestamp: -1 });

export const PairSnapshotModel = mongoose.model<PairSnapshotDoc>(
  "PairSnapshot",
  pairSnapshotSchema,
  "pair_snapshots",
);

// ============================================================
// BondSnapshot - foto individual del bono cada N segundos
// ============================================================
interface BondSnapshotDoc extends BondSnapshot, Document {}

const bondSnapshotSchema = new Schema<BondSnapshotDoc>(
  {
    bondId: { type: String, required: true, index: true },
    fullTicker: { type: String, required: true, index: true },
    ticker: { type: String, required: true, index: true },
    timestamp: { type: Date, required: true, index: true },
    price: { type: Number, required: true },
    bid: { type: Number },
    ask: { type: Number },
    volumeNominal: { type: Number, default: 0 },
    volumeInter: { type: Number, default: 0 },
    raw: { type: Object, required: true },
    sessionPhase: {
      type: String,
      enum: SESSION_PHASES,
      required: true,
      index: true,
    },
  },
  { timestamps: false },
);

bondSnapshotSchema.index({ bondId: 1, timestamp: -1 });

export const BondSnapshotModel = mongoose.model<BondSnapshotDoc>(
  "BondSnapshot",
  bondSnapshotSchema,
  "bond_snapshots",
);

// ============================================================
// OHLCV - velas agregadas
// ============================================================
interface OHLCVDoc extends OHLCV, Document {}

const ohlcvSchema = new Schema<OHLCVDoc>(
  {
    pairId: { type: String, required: true },
    timeframe: {
      type: String,
      enum: ["1m", "5m", "15m", "1h", "4h", "1d"],
      required: true,
    },
    openTime: { type: Date, required: true },
    closeTime: { type: Date, required: true },
    open: { type: Number, required: true },
    high: { type: Number, required: true },
    low: { type: Number, required: true },
    close: { type: Number, required: true },
    volume: { type: Number, default: 0 },
    sampleCount: { type: Number, default: 0 },
  },
  { timestamps: false },
);

ohlcvSchema.index({ pairId: 1, timeframe: 1, openTime: -1 }, { unique: true });

export const OHLCVModel = mongoose.model<OHLCVDoc>(
  "OHLCV",
  ohlcvSchema,
  "ohlcv",
);

// ============================================================
// PairDaily - rollup diario del par (sólo fase 'regular')
// ============================================================
interface PairDailyDoc extends PairDaily, Document {}

const pairDailySchema = new Schema<PairDailyDoc>(
  {
    pairId: { type: String, required: true },
    pairName: { type: String, required: true },
    date: { type: String, required: true }, // "YYYY-MM-DD" en timezone del mercado
    high: { type: Number, required: true },
    low: { type: Number, required: true },
    close: { type: Number, required: true },
    vwap: { type: Number, required: true },
    // Promedio simple del close de cada vela 5m construida sobre snapshots
    // 'regular'. Lo usa el endpoint de bandas. `default: 0` para que filas
    // viejas migradas no fallen — un backfill las recalcula.
    avgClose: { type: Number, required: true, default: 0 },
    stdDev: { type: Number, default: 0 },
    sampleCount: { type: Number, required: true },
    firstRegularTs: { type: Date, required: true },
    lastRegularTs: { type: Date, required: true },
  },
  { timestamps: true },
);

pairDailySchema.index({ pairId: 1, date: -1 }, { unique: true });

export const PairDailyModel = mongoose.model<PairDailyDoc>(
  "PairDaily",
  pairDailySchema,
  "pair_daily",
);

// ============================================================
// AlertConfig - configuración de alertas
// ============================================================
interface AlertConfigDoc extends Omit<AlertConfig, "id">, Document {}

const alertConfigSchema = new Schema<AlertConfigDoc>(
  {
    pairId: { type: String, required: true, index: true },
    pairName: { type: String, required: true },
    field: {
      type: String,
      enum: ["ratio", "spread", "priceA", "priceB"],
      default: "ratio",
      required: true,
    },
    condition: {
      type: String,
      enum: ["above", "below", "cross_above", "cross_below"],
      required: true,
    },
    threshold: { type: Number, required: true },
    message: { type: String },
    status: {
      type: String,
      enum: ["active", "triggered", "disabled"],
      default: "active",
    },
    triggeredAt: { type: Date },
  },
  { timestamps: true },
);

export const AlertConfigModel = mongoose.model<AlertConfigDoc>(
  "AlertConfig",
  alertConfigSchema,
  "alert_configs",
);

// ============================================================
// Exercise - período de operatoria sobre un par (apertura/cierre manual)
// ============================================================
interface ExerciseDoc extends Omit<Exercise, "id">, Document {}

const exerciseSchema = new Schema<ExerciseDoc>(
  {
    pairId: { type: String, required: true, index: true },
    pairName: { type: String, required: true },
    name: { type: String, required: true },
    status: {
      type: String,
      enum: ["open", "closed"],
      default: "open",
      required: true,
    },
    openedAt: { type: Date, required: true },
    closedAt: { type: Date, default: null },
    openingNotes: { type: String, default: "" },
    closingNotes: { type: String, default: "" },
    realizedPnL: { type: Number, default: 0 },
  },
  { timestamps: true },
);

exerciseSchema.index({ pairId: 1, status: 1, openedAt: -1 });

export const ExerciseModel = mongoose.model<ExerciseDoc>(
  "Exercise",
  exerciseSchema,
  "exercises",
);

// ============================================================
// ArbitrageOperation - operación con dos patas (compra A + venta B, o viceversa)
// ============================================================
interface ArbitrageOperationDoc
  extends Omit<ArbitrageOperation, "id">,
    Document {}

const arbitrageOperationSchema = new Schema<ArbitrageOperationDoc>(
  {
    exerciseId: { type: String, required: true, index: true },
    pairId: { type: String, required: true, index: true },
    timestamp: { type: Date, required: true },
    side: {
      type: String,
      enum: ["buy_ratio", "sell_ratio"],
      required: true,
    },
    // Signo positivo = compré, negativo = vendí
    nominalsA: { type: Number, required: true },
    priceA: { type: Number, required: true },
    nominalsB: { type: Number, required: true },
    priceB: { type: Number, required: true },
    executedRatio: { type: Number, required: true },
    notes: { type: String, default: "" },
  },
  { timestamps: true },
);

arbitrageOperationSchema.index({ exerciseId: 1, timestamp: 1 });

export const ArbitrageOperationModel =
  mongoose.model<ArbitrageOperationDoc>(
    "ArbitrageOperation",
    arbitrageOperationSchema,
    "arbitrage_operations",
  );

// ============================================================
// AppSettings - configuración global de la UI (singleton)
// ============================================================
// Doc único con _id: "global". Acceso: findById("global"); escritura:
// findOneAndUpdate({_id:"global"}, ..., {upsert:true, new:true}).

interface AppSettingsDoc extends Document {
  _id: string;
  ratioChart: RatioChartSettings;
}

const LINE_STYLES = ["solid", "dashed", "dotted"] as const;
const TIMEFRAMES = ["5m", "15m", "1h", "4h", "1d"] as const;

const indicatorLineSchemaDef = {
  enabled: { type: Boolean, required: true },
  color: { type: String, required: true },
  width: { type: Number, required: true, min: 1, max: 6 },
  style: { type: String, enum: LINE_STYLES, required: true },
};

const ratioChartSettingsSchema = new Schema(
  {
    timeframe: { type: String, enum: TIMEFRAMES, required: true },
    sma: {
      ...indicatorLineSchemaDef,
      period: { type: Number, required: true, min: 2, max: 1000 },
    },
    promant: indicatorLineSchemaDef,
    prommonth: indicatorLineSchemaDef,
    bollinger: {
      ...indicatorLineSchemaDef,
      period: { type: Number, required: true, min: 2, max: 1000 },
      stdDev: { type: Number, required: true, min: 0.5, max: 5 },
    },
    dailyBands: {
      enabled: { type: Boolean, required: true },
      upperColor: { type: String, required: true },
      lowerColor: { type: String, required: true },
      width: { type: Number, required: true, min: 1, max: 6 },
      style: { type: String, enum: LINE_STYLES, required: true },
    },
  },
  { _id: false },
);

const appSettingsSchema = new Schema<AppSettingsDoc>(
  {
    _id: { type: String, default: "global" },
    ratioChart: { type: ratioChartSettingsSchema, required: true },
  },
  { timestamps: true, _id: false },
);

export const AppSettingsModel = mongoose.model<AppSettingsDoc>(
  "AppSettings",
  appSettingsSchema,
  "app_settings",
);
