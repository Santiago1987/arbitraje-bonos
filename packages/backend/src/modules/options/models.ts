/**
 * Modelos Mongoose del dominio Opciones.
 * Colecciones con prefijo `options_` para aislarlas del dominio bonos
 * (misma base de datos, distinto namespace).
 */

import mongoose, { Schema, Document } from "mongoose";
import type { OptionStrategy, StrategyLeg } from "@arbitraje/shared";

interface StrategyDoc extends Omit<OptionStrategy, "id">, Document {}

const legSchema = new Schema<StrategyLeg>(
  {
    id: { type: String, required: true },
    kind: { type: String, enum: ["option", "underlying"], required: true },
    side: { type: String, enum: ["long", "short"], required: true },
    quantity: { type: Number, required: true },
    entryPrice: { type: Number, required: true },
    multiplier: { type: Number, required: true, default: 100 },
    optionType: { type: String, enum: ["call", "put"] },
    strike: { type: Number },
    expiration: { type: String },
    impliedVol: { type: Number },
    symbol: { type: String },
  },
  { _id: false },
);

const strategySchema = new Schema<StrategyDoc>(
  {
    name: { type: String, required: true },
    underlying: { type: String, required: true },
    spot: { type: Number, required: true },
    legs: { type: [legSchema], default: [] },
  },
  { timestamps: true },
);

export const OptionStrategyModel = mongoose.model<StrategyDoc>(
  "OptionStrategy",
  strategySchema,
  "options_strategies",
);
