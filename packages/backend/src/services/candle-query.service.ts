import type { OHLCV, TimeframeKey } from "@arbitraje/shared";
import { OHLCVModel } from "../models/index.js";

const TIMEFRAME_MS: Record<TimeframeKey, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

export const SUPPORTED_TIMEFRAMES = [
  "5m",
  "15m",
  "1h",
  "4h",
  "1d",
] as const satisfies readonly TimeframeKey[];

export type SupportedTimeframe = (typeof SUPPORTED_TIMEFRAMES)[number];

export interface CandleQueryOptions {
  pairId: string;
  timeframe: TimeframeKey;
  from?: Date;
  to?: Date;
  limit: number;
}

/**
 * CandleQueryService
 *
 * Lee las velas base de 5m de Mongo y las agrupa al timeframe pedido
 * con un aggregation pipeline. Para `5m` es un find directo.
 *
 * Acotamos el rango cuando el usuario no pasa `from` para evitar escanear
 * toda la historia: pedimos ~`limit` buckets hacia atrás desde `to` (o
 * desde ahora si tampoco pasaron `to`).
 */
class CandleQueryService {
  async getCandles(opts: CandleQueryOptions): Promise<OHLCV[]> {
    const { pairId, timeframe, limit } = opts;

    if (!(SUPPORTED_TIMEFRAMES as readonly TimeframeKey[]).includes(timeframe)) {
      throw new Error(`Timeframe no soportado: ${timeframe}`);
    }

    const bucketSizeMs = TIMEFRAME_MS[timeframe];
    const to = opts.to ?? new Date();
    const from =
      opts.from ?? new Date(to.getTime() - limit * bucketSizeMs);

    if (timeframe === "5m") {
      const docs = await OHLCVModel.find({
        pairId,
        timeframe: "5m",
        openTime: { $gte: from, $lt: to },
      })
        .sort({ openTime: -1 })
        .limit(limit)
        .lean();

      return docs.reverse().map(toOHLCV);
    }

    // Timeframes mayores: agregamos sobre las velas 5m base.
    const result = await OHLCVModel.aggregate<RawAggregatedCandle>([
      {
        $match: {
          pairId,
          timeframe: "5m",
          openTime: { $gte: from, $lt: to },
        },
      },
      { $sort: { openTime: 1 } },
      {
        $group: {
          _id: {
            $toDate: {
              $subtract: [
                { $toLong: "$openTime" },
                { $mod: [{ $toLong: "$openTime" }, bucketSizeMs] },
              ],
            },
          },
          open: { $first: "$open" },
          high: { $max: "$high" },
          low: { $min: "$low" },
          close: { $last: "$close" },
          volume: { $sum: "$volume" },
          sampleCount: { $sum: "$sampleCount" },
        },
      },
      { $sort: { _id: -1 } },
      { $limit: limit },
      { $sort: { _id: 1 } },
    ]);

    return result.map((row) => ({
      pairId,
      timeframe,
      openTime: row._id,
      closeTime: new Date(row._id.getTime() + bucketSizeMs),
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
      sampleCount: row.sampleCount,
    }));
  }
}

interface RawAggregatedCandle {
  _id: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sampleCount: number;
}

function toOHLCV(doc: {
  pairId: string;
  timeframe: TimeframeKey;
  openTime: Date;
  closeTime: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sampleCount: number;
}): OHLCV {
  return {
    pairId: doc.pairId,
    timeframe: doc.timeframe,
    openTime: doc.openTime,
    closeTime: doc.closeTime,
    open: doc.open,
    high: doc.high,
    low: doc.low,
    close: doc.close,
    volume: doc.volume,
    sampleCount: doc.sampleCount,
  };
}

export const candleQueryService = new CandleQueryService();
