/**
 * Script de seed para poblar la BD con los pares iniciales.
 *
 * Uso: pnpm --filter backend seed
 *
 * Acá definís los pares que hoy tenés en tu Excel.
 * Agregá o sacá los que necesites.
 */

import "dotenv/config";
import mongoose from "mongoose";
import { BondModel, BondPairModel } from "../models.js";

const MONGO_URI =
  process.env.MONGO_URI ?? "mongodb://localhost:27017/arbitraje-bonos";

// ── Bonos a cargar ──
const BONDS = [
  // Globales (Ley NY, USD)
  {
    ticker: "GD29",
    fullTicker: "GD29_24hs",
    name: "Global 2029",
    currency: "ARS" as const,
    law: "NY" as const,
    settlement: "24hs" as const,
    maturityDate: new Date("2029-07-09"),
  },
  {
    ticker: "GD30",
    fullTicker: "GD30_24hs",
    name: "Global 2030",
    currency: "ARS" as const,
    law: "NY" as const,
    settlement: "24hs" as const,
    maturityDate: new Date("2030-07-09"),
  },
  {
    ticker: "GD35",
    fullTicker: "GD35_24hs",
    name: "Global 2035",
    currency: "ARS" as const,
    law: "NY" as const,
    settlement: "24hs" as const,
    maturityDate: new Date("2035-07-09"),
  },
  {
    ticker: "GD38",
    fullTicker: "GD38_24hs",
    name: "Global 2038",
    currency: "ARS" as const,
    law: "NY" as const,
    settlement: "24hs" as const,
    maturityDate: new Date("2038-01-09"),
  },
  {
    ticker: "GD41",
    fullTicker: "GD41_24hs",
    name: "Global 2041",
    currency: "ARS" as const,
    law: "NY" as const,
    settlement: "24hs" as const,
    maturityDate: new Date("2041-07-09"),
  },
  {
    ticker: "GD46",
    fullTicker: "GD46_24hs",
    name: "Global 2046",
    currency: "ARS" as const,
    law: "NY" as const,
    settlement: "24hs" as const,
    maturityDate: new Date("2046-07-09"),
  },

  // Bonares (Ley AR, USD)
  {
    ticker: "AL29",
    fullTicker: "AL29_24hs",
    name: "Bonar 2029",
    currency: "ARS" as const,
    law: "AR" as const,
    settlement: "24hs" as const,
    maturityDate: new Date("2029-07-09"),
  },
  {
    ticker: "AL30",
    fullTicker: "AL30_24hs",
    name: "Bonar 2030",
    currency: "ARS" as const,
    law: "AR" as const,
    settlement: "24hs" as const,
    maturityDate: new Date("2030-07-09"),
  },
  {
    ticker: "AL35",
    fullTicker: "AL35_24hs",
    name: "Bonar 2035",
    currency: "ARS" as const,
    law: "AR" as const,
    settlement: "24hs" as const,
    maturityDate: new Date("2035-07-09"),
  },
  {
    ticker: "AE38",
    fullTicker: "AE38_24hs",
    name: "Bonar 2038",
    currency: "ARS" as const,
    law: "AR" as const,
    settlement: "24hs" as const,
    maturityDate: new Date("2038-01-09"),
  },
  {
    ticker: "AL41",
    fullTicker: "AL41_24hs",
    name: "Bonar 2041",
    currency: "ARS" as const,
    law: "AR" as const,
    settlement: "24hs" as const,
    maturityDate: new Date("2041-07-09"),
  },
  {
    ticker: "AL41C",
    fullTicker: "AL41C_24hs",
    name: "Bonar 2041 Cable",
    currency: "ARS" as const,
    law: "AR" as const,
    settlement: "24hs" as const,
    maturityDate: new Date("2041-07-09"),
  },
  {
    ticker: "GD41C",
    fullTicker: "GD41C_24hs",
    name: "Global 2041 Cable",
    currency: "ARS" as const,
    law: "NY" as const,
    settlement: "24hs" as const,
    maturityDate: new Date("2041-07-09"),
  },
  {
    ticker: "AL35C",
    fullTicker: "AL35C_24hs",
    name: "Bonar 2035 Cable",
    currency: "ARS" as const,
    law: "AR" as const,
    settlement: "24hs" as const,
    maturityDate: new Date("2035-07-09"),
  },
  {
    ticker: "GD35C",
    fullTicker: "GD35C_24hs",
    name: "Global 2035 Cable",
    currency: "ARS" as const,
    law: "NY" as const,
    settlement: "24hs" as const,
    maturityDate: new Date("2035-07-09"),
  },
  {
    ticker: "GD30C",
    fullTicker: "GD30C_24hs",
    name: "Global 2030 Cable",
    currency: "ARS" as const,
    law: "NY" as const,
    settlement: "24hs" as const,
    maturityDate: new Date("2030-07-09"),
  },
  {
    ticker: "AL30C",
    fullTicker: "AL30C_24hs",
    name: "Bonar 2030 Cable",
    currency: "ARS" as const,
    law: "AR" as const,
    settlement: "24hs" as const,
    maturityDate: new Date("2030-07-09"),
  },
  {
    ticker: "GD29C",
    fullTicker: "GD29C_24hs",
    name: "Global 2029 Cable",
    currency: "ARS" as const,
    law: "NY" as const,
    settlement: "24hs" as const,
    maturityDate: new Date("2029-07-09"),
  },
  {
    ticker: "AL29C",
    fullTicker: "AL29C_24hs",
    name: "Bonar 2029 Cable",
    currency: "ARS" as const,
    law: "AR" as const,
    settlement: "24hs" as const,
    maturityDate: new Date("2029-07-09"),
  },
  {
    ticker: "AE38C",
    fullTicker: "AE38C_24hs",
    name: "Bonar 2038 Cable",
    currency: "ARS" as const,
    law: "AR" as const,
    settlement: "24hs" as const,
    maturityDate: new Date("2038-07-09"),
  },
  {
    ticker: "GD38C",
    fullTicker: "GD38C_24hs",
    name: "Global 2038 Cable",
    currency: "ARS" as const,
    law: "NY" as const,
    settlement: "24hs" as const,
    maturityDate: new Date("2038-07-09"),
  },
  {
    ticker: "GD41_CI",
    fullTicker: "GD41C_CI",
    name: "Global 2041 CI",
    currency: "ARS" as const,
    law: "NY" as const,
    settlement: "CI" as const,
    maturityDate: new Date("2041-07-09"),
  },
  {
    ticker: "AL41_CI",
    fullTicker: "AL41C_CI",
    name: "Bonar 2041 CI",
    currency: "ARS" as const,
    law: "AR" as const,
    settlement: "CI" as const,
    maturityDate: new Date("2041-07-09"),
  },
  {
    ticker: "GD30_CI",
    fullTicker: "GD30_CI",
    name: "Global 2030 CI",
    currency: "ARS" as const,
    law: "AR" as const,
    settlement: "CI" as const,
    maturityDate: new Date("2030-07-09"),
  },
  {
    ticker: "GD30D_CI",
    fullTicker: "GD30D_CI",
    name: "Global 2030D CI",
    currency: "ARS" as const,
    law: "NY" as const,
    settlement: "CI" as const,
    maturityDate: new Date("2041-07-09"),
  },
  {
    ticker: "GD30C_CI",
    fullTicker: "GD30C_CI",
    name: "Global 2030C Cable CI",
    currency: "ARS" as const,
    law: "NY" as const,
    settlement: "CI" as const,
    maturityDate: new Date("2030-07-09"),
  },
  {
    ticker: "AL30_CI",
    fullTicker: "AL30_CI",
    name: "Bonar 2030 CI",
    currency: "ARS" as const,
    law: "AR" as const,
    settlement: "CI" as const,
    maturityDate: new Date("2030-07-09"),
  },
  {
    ticker: "AL30C_CI",
    fullTicker: "AL30C_CI",
    name: "Bonar 2030 CABLE CI",
    currency: "ARS" as const,
    law: "AR" as const,
    settlement: "CI" as const,
    maturityDate: new Date("2030-07-09"),
  },
  {
    ticker: "GD41D_24hs",
    fullTicker: "GD41D_24hs",
    name: "Global 2041 Dolar 24hs",
    currency: "USD" as const,
    law: "NY" as const,
    settlement: "24hs" as const,
    maturityDate: new Date("2041-07-09"),
  },
  {
    ticker: "AL41D_24hs",
    fullTicker: "AL41D_24hs",
    name: "Bonar 2041 Dolar 24hs",
    currency: "USD" as const,
    law: "AR" as const,
    settlement: "24hs" as const,
    maturityDate: new Date("2041-07-09"),
  },
  {
    ticker: "AL35D_24hs",
    fullTicker: "AL35D_24hs",
    name: "Bonar 2035 Dolar 24hs",
    currency: "USD" as const,
    law: "AR" as const,
    settlement: "24hs" as const,
    maturityDate: new Date("2035-07-09"),
  },
  {
    ticker: "GD35D_24hs",
    fullTicker: "GD35D_24hs",
    name: "Global 2035 Dolar 24hs",
    currency: "USD" as const,
    law: "NY" as const,
    settlement: "24hs" as const,
    maturityDate: new Date("2035-07-09"),
  },
  {
    ticker: "GD30D_24hs",
    fullTicker: "GD30D_24hs",
    name: "Global 2030 Dolar 24hs",
    currency: "USD" as const,
    law: "NY" as const,
    settlement: "24hs" as const,
    maturityDate: new Date("2030-07-09"),
  },
  {
    ticker: "AL30D_24hs",
    fullTicker: "AL30D_24hs",
    name: "Bonar 2030 Dolar 24hs",
    currency: "USD" as const,
    law: "AR" as const,
    settlement: "24hs" as const,
    maturityDate: new Date("2030-07-09"),
  },
  {
    ticker: "GD29D_24hs",
    fullTicker: "GD29D_24hs",
    name: "Global 2029 Dolar 24hs",
    currency: "USD" as const,
    law: "NY" as const,
    settlement: "24hs" as const,
    maturityDate: new Date("2029-07-09"),
  },
  {
    ticker: "AL29D_24hs",
    fullTicker: "AL29D_24hs",
    name: "Bonar 2029 Dolar 24hs",
    currency: "USD" as const,
    law: "AR" as const,
    settlement: "24hs" as const,
    maturityDate: new Date("2029-07-09"),
  },
  {
    ticker: "AE38D_24hs",
    fullTicker: "AE38D_24hs",
    name: "Bonar 2038 Dolar 24hs",
    currency: "USD" as const,
    law: "AR" as const,
    settlement: "24hs" as const,
    maturityDate: new Date("2038-07-09"),
  },
  {
    ticker: "GD38D_24hs",
    fullTicker: "GD38D_24hs",
    name: "Global 2038 Dolar 24hs",
    currency: "USD" as const,
    law: "NY" as const,
    settlement: "24hs" as const,
    maturityDate: new Date("2038-07-09"),
  },

  // Bonos en pesos (podés agregar LECAP, Boncap, etc.)
];

// ── Pares de arbitraje ──
const PAIRS = [
  // GD vs AL (mismo vencimiento, distinta ley)
  {
    name: "GD29-AL29",
    bondA: "GD29",
    bondB: "AL29",
    settlementA: "24hs" as const,
    settlementB: "24hs" as const,
    type: "ratio" as const,
  },
  {
    name: "GD30-AL30",
    bondA: "GD30",
    bondB: "AL30",
    settlementA: "24hs" as const,
    settlementB: "24hs" as const,
    type: "ratio" as const,
  },
  {
    name: "GD35-AL35",
    bondA: "GD35",
    bondB: "AL35",
    settlementA: "24hs" as const,
    settlementB: "24hs" as const,
    type: "ratio" as const,
  },
  {
    name: "GD38-AE38",
    bondA: "GD38",
    bondB: "AE38",
    settlementA: "24hs" as const,
    settlementB: "24hs" as const,
    type: "ratio" as const,
  },
  {
    name: "GD41-AL41",
    bondA: "GD41",
    bondB: "AL41",
    settlementA: "24hs" as const,
    settlementB: "24hs" as const,
    type: "ratio" as const,
  },
  // Misma legislacion diferente duration
  {
    name: "GD30-GD35",
    bondA: "GD30",
    bondB: "GD35",
    settlementA: "24hs" as const,
    settlementB: "24hs" as const,
    type: "ratio" as const,
  },
  {
    name: "GD35-GD38",
    bondA: "GD35",
    bondB: "GD38",
    settlementA: "24hs" as const,
    settlementB: "24hs" as const,
    type: "ratio" as const,
  },
  {
    name: "GD38-GD41",
    bondA: "GD38",
    bondB: "GD41",
    settlementA: "24hs" as const,
    settlementB: "24hs" as const,
    type: "ratio" as const,
  },
  {
    name: "AL30-GD35",
    bondA: "AL30",
    bondB: "GD35",
    settlementA: "24hs" as const,
    settlementB: "24hs" as const,
    type: "ratio" as const,
  },
  {
    name: "AL30-AE38",
    bondA: "AL30",
    bondB: "AE38",
    settlementA: "24hs" as const,
    settlementB: "24hs" as const,
    type: "ratio" as const,
  },
  {
    name: "GD35-AE38",
    bondA: "GD35",
    bondB: "AE38",
    settlementA: "24hs" as const,
    settlementB: "24hs" as const,
    type: "ratio" as const,
  },
  {
    name: "AE38-GD41",
    bondA: "AE38",
    bondB: "GD41",
    settlementA: "24hs" as const,
    settlementB: "24hs" as const,
    type: "ratio" as const,
  },
  {
    name: "AL30D-AL30C",
    bondA: "AL30D",
    bondB: "AL30C",
    settlementA: "24hs" as const,
    settlementB: "24hs" as const,
    type: "ratio" as const,
  },
];

async function seed() {
  console.log("Conectando a MongoDB...");
  await mongoose.connect(MONGO_URI);

  // Limpiar colecciones
  console.log("Limpiando colecciones...");
  await BondModel.deleteMany({});
  await BondPairModel.deleteMany({});

  // Insertar bonos
  console.log(`Insertando ${BONDS.length} bonos...`);
  await BondModel.insertMany(BONDS);

  // Insertar pares
  console.log(`Insertando ${PAIRS.length} pares...`);
  await BondPairModel.insertMany(PAIRS.map((p) => ({ ...p, isActive: true })));

  console.log("✅ Seed completado");
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("Error en seed:", err);
  process.exit(1);
});
