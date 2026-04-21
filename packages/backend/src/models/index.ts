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
