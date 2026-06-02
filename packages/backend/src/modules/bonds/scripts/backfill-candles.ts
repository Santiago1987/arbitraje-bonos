/**
 * Backfill de velas 5m a partir de los snapshots existentes en `pair_snapshots`.
 *
 * Uso:
 *   pnpm --filter backend backfill:candles
 *   pnpm --filter backend backfill:candles -- --from=2026-01-01 --to=2026-04-25
 *   pnpm --filter backend backfill:candles -- --pair=<pairId>
 *
 * Detalles:
 * - Agrupa los snapshots en buckets de 5 minutos por par y calcula OHLC del
 *   ratio. Cuando hay varios snapshots en el mismo bucket (snapshot a 10s/60s
 *   en algún período), salen velas con O/H/L/C reales; cuando hay uno solo
 *   (snapshot a 300s), la vela queda plana.
 * - Idempotente: usa `$setOnInsert`, así nunca pisa una vela existente
 *   (las que el CandleBuilder fue generando en vivo tienen prioridad).
 * - Excluye el bucket en curso (no procesa lo que está cerrando ahora) para
 *   no competir con el CandleBuilder.
 */

import "dotenv/config";
import mongoose from "mongoose";
import { PairSnapshotModel, OHLCVModel } from "../models.js";

const MONGO_URI =
  process.env.MONGO_URI ?? "mongodb://localhost:27017/arbitraje-bonos";

const BUCKET_MS = 5 * 60_000;
const BATCH_SIZE = 500;

interface Args {
  from?: Date;
  to?: Date;
  pairId?: string;
}

function parseArgs(): Args {
  const args: Args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const raw = process.argv[i];
    const [key, value] = raw.split("=");
    if (!value) continue;
    if (key === "--from") args.from = new Date(value);
    else if (key === "--to") args.to = new Date(value);
    else if (key === "--pair") args.pairId = value;
  }
  return args;
}

interface AggregatedRow {
  _id: { pairId: string; bucket: Date };
  open: number;
  close: number;
  high: number;
  low: number;
  sampleCount: number;
}

async function backfillCandles(opts: Args): Promise<void> {
  // Excluimos el bucket en curso para no competir con el CandleBuilder en vivo.
  const now = Date.now();
  const currentBucketStart = Math.floor(now / BUCKET_MS) * BUCKET_MS;
  const cutoff = opts.to
    ? new Date(Math.min(opts.to.getTime(), currentBucketStart))
    : new Date(currentBucketStart);

  const matchStage: Record<string, unknown> = {
    timestamp: { $lt: cutoff, ...(opts.from ? { $gte: opts.from } : {}) },
  };
  if (opts.pairId) matchStage.pairId = opts.pairId;

  console.log(
    `[backfill] desde=${opts.from?.toISOString() ?? "(inicio)"} ` +
      `hasta=${cutoff.toISOString()}` +
      `${opts.pairId ? ` pair=${opts.pairId}` : ""}`,
  );

  const cursor = PairSnapshotModel.aggregate<AggregatedRow>([
    { $match: matchStage },
    { $sort: { timestamp: 1 } },
    {
      $group: {
        _id: {
          pairId: "$pairId",
          bucket: {
            $toDate: {
              $subtract: [
                { $toLong: "$timestamp" },
                { $mod: [{ $toLong: "$timestamp" }, BUCKET_MS] },
              ],
            },
          },
        },
        open: { $first: "$ratio" },
        close: { $last: "$ratio" },
        high: { $max: "$ratio" },
        low: { $min: "$ratio" },
        sampleCount: { $sum: 1 },
      },
    },
  ])
    .allowDiskUse(true)
    .cursor({ batchSize: BATCH_SIZE });

  let buffer: Parameters<typeof OHLCVModel.bulkWrite>[0] = [];
  let totalInserted = 0;
  let totalProcessed = 0;

  const flush = async () => {
    if (buffer.length === 0) return;
    const result = await OHLCVModel.bulkWrite(buffer, { ordered: false });
    totalInserted += result.upsertedCount ?? 0;
    totalProcessed += buffer.length;
    console.log(
      `  ${totalProcessed} buckets evaluados (${totalInserted} velas insertadas)`,
    );
    buffer = [];
  };

  for await (const row of cursor) {
    const bucket = row._id.bucket;
    const closeTime = new Date(bucket.getTime() + BUCKET_MS);

    buffer.push({
      updateOne: {
        filter: {
          pairId: row._id.pairId,
          timeframe: "5m",
          openTime: bucket,
        },
        update: {
          $setOnInsert: {
            pairId: row._id.pairId,
            timeframe: "5m",
            openTime: bucket,
            closeTime,
            open: row.open,
            high: row.high,
            low: row.low,
            close: row.close,
            volume: 0,
            sampleCount: row.sampleCount,
          },
        },
        upsert: true,
      },
    });

    if (buffer.length >= BATCH_SIZE) {
      await flush();
    }
  }

  await flush();

  console.log(
    `\n✅ Backfill completo: ${totalInserted} velas nuevas / ${totalProcessed} buckets evaluados`,
  );
}

async function main() {
  const args = parseArgs();
  console.log("Conectando a MongoDB...");
  await mongoose.connect(MONGO_URI);

  try {
    await backfillCandles(args);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error("Error en backfill:", err);
  process.exit(1);
});
