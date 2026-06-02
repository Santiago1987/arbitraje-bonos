import { BondSnapshotModel } from "../models.js";
import { getSessionConfig } from "../../../utils/session.js";
import type { SettlementType } from "@arbitraje/shared";

export interface BondCandle {
  pairId: string; // sintético: fullTicker (single) o "fullTickerA/fullTickerB" (ratio)
  timeframe: "1d";
  openTime: Date;
  closeTime: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sampleCount: number;
}

interface BondRef {
  ticker: string;
  settlement: SettlementType;
}

const fullTickerOf = (b: BondRef): string => `${b.ticker}_${b.settlement}`;

// Midnight UTC del localDate "YYYY-MM-DD". Da una clave temporal estable y
// lightweight-charts la muestra como el día correspondiente.
const localDateToUTCDate = (date: string): Date =>
  new Date(`${date}T00:00:00.000Z`);

// Default: ventana abierta hacia atrás (sin filtrar) y hasta ahora.
const DEFAULT_FROM = new Date("2000-01-01T00:00:00.000Z");

export interface BondCandleQuery {
  ticker: string;
  settlement: SettlementType;
  from?: Date;
  to?: Date;
  limit?: number;
}

/**
 * Velas diarias del precio de un bono individual (sólo fase 'regular').
 * Agrega los `BondSnapshot` por día local del mercado y calcula OHLC del
 * campo `price` (último operado), volumen sumado y sampleCount.
 */
export async function getBondDailyCandles(
  q: BondCandleQuery,
): Promise<BondCandle[]> {
  const cfg = getSessionConfig();
  const fullTicker = fullTickerOf({ ticker: q.ticker, settlement: q.settlement });
  const from = q.from ?? DEFAULT_FROM;
  const to = q.to ?? new Date();
  const limit = q.limit ?? 1000;

  const rows = await BondSnapshotModel.aggregate<{
    _id: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    sampleCount: number;
    firstTs: Date;
    lastTs: Date;
  }>([
    {
      $match: {
        fullTicker,
        sessionPhase: "regular",
        timestamp: { $gte: from, $lte: to },
      },
    },
    {
      $addFields: {
        localDate: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: "$timestamp",
            timezone: cfg.timezone,
          },
        },
      },
    },
    { $sort: { timestamp: 1 } },
    {
      $group: {
        _id: "$localDate",
        open: { $first: "$price" },
        close: { $last: "$price" },
        high: { $max: "$price" },
        low: { $min: "$price" },
        volume: { $sum: "$volumeNominal" },
        sampleCount: { $sum: 1 },
        firstTs: { $first: "$timestamp" },
        lastTs: { $last: "$timestamp" },
      },
    },
    { $sort: { _id: -1 } },
    { $limit: limit },
  ]);

  return rows
    .map<BondCandle>((r) => ({
      pairId: fullTicker,
      timeframe: "1d",
      openTime: localDateToUTCDate(r._id),
      closeTime: r.lastTs,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
      sampleCount: r.sampleCount,
    }))
    .sort((a, b) => a.openTime.getTime() - b.openTime.getTime());
}

export interface RatioCandleQuery {
  a: BondRef;
  b: BondRef;
  from?: Date;
  to?: Date;
  limit?: number;
}

/**
 * Velas diarias del cociente A/B construidas al vuelo desde BondSnapshot.
 *
 * Estrategia (híbrido aggregation + JS):
 *   1) MongoDB agrupa los snapshots de A y B en buckets de 1 minuto, tomando
 *      el último `price` de cada bucket por ticker.
 *   2) En memoria, para cada bucket donde hay datos de los DOS bonos se
 *      calcula ratio = priceA / priceB.
 *   3) Se hace OHLC del ratio por día local del mercado.
 *
 * El último paso queda en JS porque pivotar A/B y luego rollar a día en
 * pipeline se vuelve frágil — la cantidad de buckets de 1 minuto por día es
 * del orden de cientos, manejable en memoria.
 */
export async function getRatioDailyCandles(
  q: RatioCandleQuery,
): Promise<BondCandle[]> {
  const cfg = getSessionConfig();
  const ftA = fullTickerOf(q.a);
  const ftB = fullTickerOf(q.b);
  const from = q.from ?? DEFAULT_FROM;
  const to = q.to ?? new Date();
  const limit = q.limit ?? 1000;

  // bucketMs: timestamp truncado al minuto (en lugar de $dateTrunc, que
  // requiere Mongo 5+, usamos $subtract con $mod para máxima compatibilidad).
  const buckets = await BondSnapshotModel.aggregate<{
    _id: { ft: string; bucket: number };
    price: number;
    localDate: string;
  }>([
    {
      $match: {
        fullTicker: { $in: [ftA, ftB] },
        sessionPhase: "regular",
        timestamp: { $gte: from, $lte: to },
      },
    },
    {
      $addFields: {
        bucketMs: {
          $subtract: [
            { $toLong: "$timestamp" },
            { $mod: [{ $toLong: "$timestamp" }, 60_000] },
          ],
        },
        localDate: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: "$timestamp",
            timezone: cfg.timezone,
          },
        },
      },
    },
    { $sort: { timestamp: 1 } },
    {
      $group: {
        _id: { ft: "$fullTicker", bucket: "$bucketMs" },
        price: { $last: "$price" },
        localDate: { $last: "$localDate" },
      },
    },
    { $sort: { "_id.bucket": 1 } },
  ]);

  // Pivotar A/B por bucket en memoria.
  type PerBucket = { localDate: string; priceA?: number; priceB?: number };
  const byBucket = new Map<number, PerBucket>();
  for (const row of buckets) {
    const key = row._id.bucket;
    let entry = byBucket.get(key);
    if (!entry) {
      entry = { localDate: row.localDate };
      byBucket.set(key, entry);
    }
    if (row._id.ft === ftA) entry.priceA = row.price;
    else if (row._id.ft === ftB) entry.priceB = row.price;
  }

  // Ratios por día local — recorremos en orden ASC de bucket para que
  // open/close del ratio respeten cronología.
  type DayAcc = {
    open: number;
    close: number;
    high: number;
    low: number;
    sampleCount: number;
    firstTs: Date;
    lastTs: Date;
  };
  const byDay = new Map<string, DayAcc>();

  const sortedBuckets = [...byBucket.entries()].sort(
    ([a], [b]) => a - b,
  );

  for (const [bucketMs, entry] of sortedBuckets) {
    if (entry.priceA == null || entry.priceB == null) continue;
    if (!Number.isFinite(entry.priceA) || !Number.isFinite(entry.priceB)) continue;
    if (entry.priceB === 0) continue;

    const ratio = entry.priceA / entry.priceB;
    const ts = new Date(bucketMs);
    const day = entry.localDate;

    const acc = byDay.get(day);
    if (!acc) {
      byDay.set(day, {
        open: ratio,
        close: ratio,
        high: ratio,
        low: ratio,
        sampleCount: 1,
        firstTs: ts,
        lastTs: ts,
      });
    } else {
      acc.close = ratio;
      if (ratio > acc.high) acc.high = ratio;
      if (ratio < acc.low) acc.low = ratio;
      acc.sampleCount += 1;
      acc.lastTs = ts;
    }
  }

  const pairId = `${ftA}/${ftB}`;
  const candles: BondCandle[] = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, acc]) => ({
      pairId,
      timeframe: "1d" as const,
      openTime: localDateToUTCDate(date),
      closeTime: acc.lastTs,
      open: acc.open,
      high: acc.high,
      low: acc.low,
      close: acc.close,
      volume: 0,
      sampleCount: acc.sampleCount,
    }));

  // Conservar las últimas `limit` velas (asc).
  return candles.slice(-limit);
}
