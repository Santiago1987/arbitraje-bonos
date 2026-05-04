/**
 * Backfill de cotizaciones históricas diarias desde IOL hacia `bond_snapshots`.
 *
 * Uso:
 *   1) Editar las variables TOKEN y ACTIVO al tope del archivo.
 *   2) pnpm --filter backend backfill:iol
 *
 * Detalles:
 * - Trae histórico desde 01-01-2020 hasta hoy para el ticker en `ACTIVO`,
 *   settlement 24hs, en bCBA, sinAjustar.
 * - Convierte la `fechaHora` (UTC-3) a UTC antes de guardar.
 * - Inserta 1 documento por día con `price = ultimoPrecio`. OHLC quedan en `raw`.
 * - Idempotente: si ya hay un snapshot del día (en cualquier hora) para ese
 *   bono, ese día se saltea — la BD tiene prioridad.
 * - Aborta con error si el bono no existe en la collection `bonds`.
 */

import "dotenv/config";
import mongoose from "mongoose";
import { BondModel, BondSnapshotModel } from "../models/index.js";
import { getSessionConfig, getLocalDateKey } from "../utils/session.js";

// === EDITAR ANTES DE CORRER ====================================
const TOKEN =
  "eyJhbGciOiJSUzI1NiIsInR5cCI6ImF0K2p3dCJ9.eyJzdWIiOiI3MDQzOTkiLCJJRCI6IjcwNDM5OSIsImp0aSI6IjBjMjFkOTU1LWFkZjUtNDY1My05YTE3LTdlNzU5MWYzYTk4MyIsImNvbnN1bWVyX3R5cGUiOiIxIiwidGllbmVfY3VlbnRhIjoiVHJ1ZSIsInRpZW5lX3Byb2R1Y3RvX2J1cnNhdGlsIjoiVHJ1ZSIsInRpZW5lX3Byb2R1Y3RvX2FwaSI6IlRydWUiLCJ0aWVuZV9UeUMiOiJUcnVlIiwibmJmIjoxNzc3ODI5MjExLCJleHAiOjE3Nzc4MzAxMTEsImlhdCI6MTc3NzgyOTIxMSwiaXNzIjoiSU9MT2F1dGhTZXJ2ZXIiLCJhdWQiOiJJT0xPYXV0aFNlcnZlciJ9.lHTb3bpKvDQvOdvRO2NSZVgUpPEUc5jopGNkeU3QLuHXu1fFyE8uqCoANFCGZ4EY1CfmBG1OyO8_bpaVYUrCX4Lm79JJaUy7pHZpScMh62qQRgDSQ2imIF_UCol2Pt4yjFjp3a0ZKoxvAohxIiD0_6hWmGW3jquUY9uthc33Ep8irvUwhW7Wgi0x5GxE9KQP1vhOVNZ3-lnz-TchuyfyrGUC2sFkQfAEbRc8oLpe1JrPS0Hjmce2mDE_rv7lzu025YZdUPcho1EcKitvJCuk2WcJtSwf10aLJnIg3ULDJff69tmGgls1Mx4TG0HpPbL9PDil7fPoVKNxr5_dljtQ7Q";
const ACTIVO = "GD41";
// ===============================================================

const MERCADO = "bCBA";
const FECHA_DESDE = "01-01-2020";
const AJUSTADA = "sinAjustar";
const SETTLEMENT = "24hs" as const;

const MONGO_URI =
  process.env.MONGO_URI ?? "mongodb://localhost:27017/arbitraje-bonos";
const BATCH_SIZE = 500;

interface IolHistoricalRow {
  ultimoPrecio: number;
  variacion: number | null;
  apertura: number | null;
  maximo: number | null;
  minimo: number | null;
  fechaHora: string; // "2026-04-30T16:52:49.413" (UTC-3, sin offset)
  tendencia: string | null;
  cierreAnterior: number | null;
  montoOperado: number | null;
  volumenNominal: number | null;
  precioPromedio: number | null;
  moneda: string | null;
  precioAjuste: number | null;
  interesesAbiertos: number | null;
  puntas: unknown;
  cantidadOperaciones: number | null;
  descripcionTitulo: string | null;
  plazo: string | null;
  laminaMinima: number | null;
  lote: number | null;
}

function todayDdMmYyyy(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function parseFechaHoraUTC3(s: string): Date {
  return new Date(`${s}-03:00`);
}

async function fetchHistorical(): Promise<IolHistoricalRow[]> {
  const fechaHasta = todayDdMmYyyy();
  const url =
    `https://api.invertironline.com/api/v2/${MERCADO}` +
    `/Titulos/${ACTIVO}/Cotizacion/seriehistorica` +
    `/${FECHA_DESDE}/${fechaHasta}/${AJUSTADA}`;

  console.log(`[iol] GET ${url}`);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/json",
    },
  });

  if (res.status === 401) {
    throw new Error(
      "IOL respondió 401 — el token Bearer es inválido o expiró. " +
        "Generá uno nuevo y pegalo en la variable TOKEN.",
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`IOL respondió ${res.status} ${res.statusText}: ${body}`);
  }

  const data = (await res.json()) as IolHistoricalRow[];
  if (!Array.isArray(data)) {
    throw new Error(
      `Respuesta inesperada de IOL (no es array): ${JSON.stringify(data).slice(0, 200)}`,
    );
  }
  return data;
}

interface DayBucket {
  row: IolHistoricalRow;
  fechaUtc: Date;
}

function groupByLocalDay(
  rows: IolHistoricalRow[],
  timezone: string,
): Map<string, DayBucket> {
  const map = new Map<string, DayBucket>();
  for (const row of rows) {
    if (!row?.fechaHora) continue;
    const fechaUtc = parseFechaHoraUTC3(row.fechaHora);
    if (Number.isNaN(fechaUtc.getTime())) {
      console.warn(`[iol] fechaHora inválida, salteo: ${row.fechaHora}`);
      continue;
    }
    const localDate = getLocalDateKey(fechaUtc, timezone);
    const existing = map.get(localDate);
    if (!existing || fechaUtc.getTime() > existing.fechaUtc.getTime()) {
      map.set(localDate, { row, fechaUtc });
    }
  }
  return map;
}

async function getExistingDays(
  fullTicker: string,
  timezone: string,
): Promise<Set<string>> {
  const rows = await BondSnapshotModel.aggregate<{ _id: string }>([
    { $match: { fullTicker } },
    {
      $group: {
        _id: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: "$timestamp",
            timezone,
          },
        },
      },
    },
  ]);
  return new Set(rows.map((r) => r._id));
}

async function run(): Promise<void> {
  if (!TOKEN) {
    throw new Error(
      "TOKEN está vacío. Editá la variable TOKEN al tope del script con tu Bearer de IOL.",
    );
  }
  if (!ACTIVO) {
    throw new Error(
      "ACTIVO está vacío. Editá la variable ACTIVO al tope del script con el ticker (ej: GD41).",
    );
  }

  const fullTicker = `${ACTIVO}_${SETTLEMENT}`;
  const cfg = getSessionConfig();

  console.log("Conectando a MongoDB...");
  await mongoose.connect(MONGO_URI);

  try {
    const bond = await BondModel.findOne({ fullTicker });
    if (!bond) {
      throw new Error(
        `No existe el bono '${fullTicker}' en la collection 'bonds'. ` +
          `Seedealo primero (pnpm --filter backend seed) o agregalo manualmente.`,
      );
    }
    const bondId = String(bond._id);

    const rows = await fetchHistorical();
    console.log(`[iol] recibidos ${rows.length} registros`);
    if (rows.length === 0) {
      console.log("Nada para insertar.");
      return;
    }

    const byDay = groupByLocalDay(rows, cfg.timezone);
    console.log(`[iol] ${byDay.size} días únicos tras agrupar por día local`);

    const existingDays = await getExistingDays(fullTicker, cfg.timezone);
    console.log(
      `[bd] ${existingDays.size} días ya presentes para ${fullTicker} — esos se saltean`,
    );

    const ops: Parameters<typeof BondSnapshotModel.bulkWrite>[0] = [];
    let skipped = 0;
    let firstInsertedDay: string | null = null;
    let lastInsertedDay: string | null = null;

    const sortedDays = [...byDay.keys()].sort();
    for (const localDate of sortedDays) {
      if (existingDays.has(localDate)) {
        skipped++;
        continue;
      }
      const { row, fechaUtc } = byDay.get(localDate)!;

      ops.push({
        insertOne: {
          document: {
            bondId,
            fullTicker,
            ticker: ACTIVO,
            timestamp: fechaUtc,
            price: row.ultimoPrecio,
            bid: null,
            ask: null,
            volumeNominal: row.volumenNominal ?? 0,
            volumeInter: row.montoOperado ?? 0,
            raw: {
              apertura: row.apertura,
              maximo: row.maximo,
              minimo: row.minimo,
              ultimoPrecio: row.ultimoPrecio,
              cierreAnterior: row.cierreAnterior,
              variacion: row.variacion,
              tendencia: row.tendencia,
              cantidadOperaciones: row.cantidadOperaciones,
              precioPromedio: row.precioPromedio,
              moneda: row.moneda,
              fechaHoraOriginal: row.fechaHora,
              source: "iol-seriehistorica",
              settlement: SETTLEMENT,
            },
            sessionPhase: "regular",
          },
        },
      });

      if (!firstInsertedDay) firstInsertedDay = localDate;
      lastInsertedDay = localDate;
    }

    let inserted = 0;
    for (let i = 0; i < ops.length; i += BATCH_SIZE) {
      const slice = ops.slice(i, i + BATCH_SIZE);
      const result = await BondSnapshotModel.bulkWrite(slice, {
        ordered: false,
      });
      inserted += result.insertedCount ?? 0;
      console.log(
        `  lote ${i / BATCH_SIZE + 1}: ${result.insertedCount ?? 0} insertados`,
      );
    }

    console.log("");
    console.log(`✅ Backfill completo para ${fullTicker}`);
    console.log(`   recibidos:  ${rows.length}`);
    console.log(`   días únicos: ${byDay.size}`);
    console.log(`   salteados (ya en BD): ${skipped}`);
    console.log(`   insertados nuevos: ${inserted}`);
    if (firstInsertedDay && lastInsertedDay) {
      console.log(
        `   rango insertado: ${firstInsertedDay} → ${lastInsertedDay}`,
      );
    }
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((err) => {
  console.error(
    "Error en backfill:iol:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
