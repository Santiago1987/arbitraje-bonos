/**
 * Modelo Mongoose del dominio Acciones (argentinas).
 * Colección `Arg_Stock`: un snapshot diario por símbolo+plazo+día.
 */

import mongoose, { Schema, Document } from "mongoose";
import type { ArgStock } from "@arbitraje/shared";

interface ArgStockDoc extends ArgStock, Document {
  /** Clave de día "YYYY-MM-DD" (timezone de sesión) derivada de `fecha`. */
  date: string;
}

const argStockSchema = new Schema<ArgStockDoc>(
  {
    simbolo: { type: String, required: true },
    ultimoPrecio: { type: Number, required: true },
    variacionPorcentual: { type: Number, default: 0 },
    apertura: { type: Number, default: 0 },
    maximo: { type: Number, default: 0 },
    minimo: { type: Number, default: 0 },
    volumen: { type: Number, default: 0 },
    cantidadOperaciones: { type: Number, default: 0 },
    fecha: { type: Date, required: true },
    descripcion: { type: String, default: "" },
    plazo: { type: String, default: "" },
    date: { type: String, required: true },
  },
  { timestamps: true },
);

// Un único documento por acción/plazo/día. El job hace upsert sobre esta clave,
// así re-correrlo el mismo día sobrescribe en vez de duplicar.
argStockSchema.index({ simbolo: 1, plazo: 1, date: 1 }, { unique: true });
argStockSchema.index({ date: -1 });

export const ArgStockModel = mongoose.model<ArgStockDoc>(
  "ArgStock",
  argStockSchema,
  "Arg_Stock",
);
