import { config } from "../config/index.js";
import {
  BondPairModel,
  PairSnapshotModel,
  PairDailyModel,
} from "../models/index.js";
import { logger } from "../utils/logger.js";
import { getLocalDateKey, getSessionConfig } from "../utils/session.js";

/**
 * DailyRollupService
 *
 * Agrega los snapshots `regular` (excluye warmup/cooldown/pre_open/post_close)
 * por par y por día, y hace upsert en `pair_daily`. Es idempotente: correrlo
 * varias veces en el mismo día recalcula y sobrescribe la fila del día.
 */
class DailyRollupService {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Rolleamos una vez al arrancar para cubrir el día en curso
    this.rollupToday().catch((err) =>
      logger.error({ err }, "Error en rollup inicial"),
    );

    this.intervalId = setInterval(
      () => {
        this.rollupToday().catch((err) =>
          logger.error({ err }, "Error en rollup periódico"),
        );
      },
      config.DAILY_ROLLUP_INTERVAL_MS,
    );

    logger.info(
      `DailyRollupService iniciado - cada ${config.DAILY_ROLLUP_INTERVAL_MS / 1000}s`,
    );
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info("DailyRollupService detenido");
  }

  /**
   * Rollup del día actual (según timezone del mercado).
   */
  async rollupToday(): Promise<void> {
    const cfg = getSessionConfig();
    const today = getLocalDateKey(new Date(), cfg.timezone);
    await this.rollupDate(today);
  }

  /**
   * Rollup de una fecha específica ("YYYY-MM-DD" en timezone del mercado).
   * Agrega todos los snapshots `regular` de ese día local y hace upsert.
   */
  async rollupDate(date: string): Promise<void> {
    const cfg = getSessionConfig();
    // Ventana UTC generosa (±24h alrededor del mediodía UTC del día local).
    // El filtro fino por fecha local se hace con $dateToString + timezone
    // dentro del pipeline, así Mongo delega la conversión a la timezone.
    const anchor = new Date(`${date}T12:00:00Z`);
    const from = new Date(anchor.getTime() - 24 * 3600 * 1000);
    const to = new Date(anchor.getTime() + 24 * 3600 * 1000);

    const pairs = await BondPairModel.find({ isActive: true }).lean();
    if (pairs.length === 0) return;

    const pairIds = pairs.map((p) => p._id.toString());
    const pairNameById = new Map(
      pairs.map((p) => [p._id.toString(), p.name]),
    );

    const rows = await PairSnapshotModel.aggregate([
      {
        $match: {
          pairId: { $in: pairIds },
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
      { $match: { localDate: date } },
      { $sort: { timestamp: 1 } },
      {
        $group: {
          _id: "$pairId",
          ratios: { $push: "$ratio" },
          // `timestamps` se preserva en el mismo orden que `ratios` (gracias al
          // $sort previo). Lo usamos abajo para bucketear en velas de 5m y
          // calcular `avgClose` (promedio del close de cada vela).
          timestamps: { $push: "$timestamp" },
          // Peso VWAP = volumen de la pata A (mejor proxy disponible).
          weights: { $push: "$volumeA" },
          high: { $max: "$ratio" },
          low: { $min: "$ratio" },
          firstTs: { $min: "$timestamp" },
          lastTs: { $max: "$timestamp" },
          count: { $sum: 1 },
        },
      },
    ]);

    if (rows.length === 0) {
      logger.debug(`No hay snapshots regular para ${date}`);
      return;
    }

    const bulkOps: Parameters<typeof PairDailyModel.bulkWrite>[0] = [];

    for (const row of rows) {
      const pairId = row._id as string;
      const ratios: number[] = row.ratios;
      const weights: number[] = row.weights;
      const timestamps: Date[] = row.timestamps;
      const n = ratios.length;
      if (n === 0) continue;

      const totalWeight = weights.reduce((a, b) => a + b, 0);
      const vwap =
        totalWeight > 0
          ? ratios.reduce((acc, r, i) => acc + r * weights[i], 0) / totalWeight
          : ratios.reduce((a, b) => a + b, 0) / n;

      const mean = ratios.reduce((a, b) => a + b, 0) / n;
      const stdDev =
        n > 1
          ? Math.sqrt(
              ratios.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (n - 1),
            )
          : 0;

      // avgClose: promedio del close de cada vela de 5m de la rueda.
      // Como los snapshots están ordenados ASC y filtrados a fase 'regular',
      // recorremos secuencialmente: cada vez que cambia el bucket de 5m,
      // empujamos el último ratio del bucket anterior (= su close).
      // Resultado: una vela de 5m por bucket que tuvo al menos un snapshot
      // 'regular'. Las velas que straddlean warmup→regular usan sólo la
      // porción regular, lo cual es exactamente lo que queremos.
      const BUCKET_MS = 5 * 60_000;
      const closes: number[] = [];
      let lastBucket = -1;
      let currentClose = 0;
      for (let i = 0; i < n; i++) {
        const bucket = Math.floor(timestamps[i].getTime() / BUCKET_MS);
        if (bucket !== lastBucket) {
          if (lastBucket !== -1) closes.push(currentClose);
          lastBucket = bucket;
        }
        currentClose = ratios[i];
      }
      if (lastBucket !== -1) closes.push(currentClose);
      const avgClose =
        closes.length > 0
          ? closes.reduce((a, b) => a + b, 0) / closes.length
          : ratios[n - 1];

      bulkOps.push({
        updateOne: {
          filter: { pairId, date },
          update: {
            $set: {
              pairId,
              pairName: pairNameById.get(pairId) ?? "",
              date,
              high: row.high,
              low: row.low,
              close: ratios[n - 1],
              vwap,
              avgClose,
              stdDev,
              sampleCount: n,
              firstRegularTs: row.firstTs,
              lastRegularTs: row.lastTs,
            },
          },
          upsert: true,
        },
      });
    }

    if (bulkOps.length > 0) {
      await PairDailyModel.bulkWrite(bulkOps);
      logger.info(`Rollup ${date}: ${bulkOps.length} pares actualizados`);
    }
  }

  /**
   * Recalcula el rollup para un rango de fechas. Útil para backfill o si
   * se cambia la ventana de warmup/cooldown y hay que re-etiquetar todo.
   */
  async backfillRange(fromDate: string, toDate: string): Promise<void> {
    const from = new Date(`${fromDate}T12:00:00Z`);
    const to = new Date(`${toDate}T12:00:00Z`);
    const cfg = getSessionConfig();

    let cursor = from;
    let count = 0;
    while (cursor.getTime() <= to.getTime()) {
      const dateKey = getLocalDateKey(cursor, cfg.timezone);
      await this.rollupDate(dateKey);
      cursor = new Date(cursor.getTime() + 24 * 3600 * 1000);
      count++;
    }
    logger.info(`Backfill completo: ${count} días`);
  }
}

export const dailyRollupService = new DailyRollupService();
