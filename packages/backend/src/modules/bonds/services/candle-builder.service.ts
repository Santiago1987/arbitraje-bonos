import type { PairLiveData } from "@arbitraje/shared";
import { eventBus } from "./event-bus.js";
import { OHLCVModel } from "../models.js";
import { logger } from "../../../utils/logger.js";

const CANDLE_INTERVAL_MS = 5 * 60_000;
const FLUSH_CHECK_MS = 30_000;

interface InProgressCandle {
  pairId: string;
  bucketStart: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  sampleCount: number;
}

/**
 * CandleBuilderService
 *
 * Construye velas OHLC de 5 minutos en memoria a partir de los eventos
 * `pair:update`. Cuando un evento cae en un nuevo bucket de 5 minutos,
 * cierra y persiste la vela anterior (upsert en `ohlcv` con timeframe="5m")
 * y arranca una nueva. Un timer periódico también flushea velas cuyo
 * bucket ya cerró por inactividad.
 *
 * El "valor" de la vela es el ratio del par. Volumen no se trackea por
 * ahora (vol_nom es cumulativo y mezclar las dos patas no es trivial).
 */
class CandleBuilderService {
  private inProgress = new Map<string, InProgressCandle>();
  private flushIntervalId: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private listener: ((data: PairLiveData) => void) | null = null;

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.listener = (data) => this.onPairUpdate(data);
    eventBus.on("pair:update", this.listener);

    this.flushIntervalId = setInterval(() => {
      this.flushExpired().catch((err) =>
        logger.error({ err }, "Error en flush periódico de velas"),
      );
    }, FLUSH_CHECK_MS);

    logger.info(
      `CandleBuilderService iniciado - bucket 5m, flush check ${FLUSH_CHECK_MS / 1000}s`,
    );
  }

  async stop(): Promise<void> {
    if (this.flushIntervalId) {
      clearInterval(this.flushIntervalId);
      this.flushIntervalId = null;
    }
    if (this.listener) {
      eventBus.off("pair:update", this.listener);
      this.listener = null;
    }
    this.isRunning = false;

    // Flush de todo lo pendiente al apagar para no perder la vela en curso
    // si su bucket ya cerró.
    await this.flushAll();
    logger.info("CandleBuilderService detenido");
  }

  private bucketStartFor(ts: Date): Date {
    const ms = ts.getTime();
    return new Date(Math.floor(ms / CANDLE_INTERVAL_MS) * CANDLE_INTERVAL_MS);
  }

  private onPairUpdate(data: PairLiveData): void {
    const ratio = data.currentRatio;
    if (!Number.isFinite(ratio)) return;

    const bucketStart = this.bucketStartFor(data.timestamp);
    const existing = this.inProgress.get(data.pairId);

    if (!existing || existing.bucketStart.getTime() !== bucketStart.getTime()) {
      // Bucket nuevo: cerrar el anterior (si existe) y arrancar uno fresco.
      if (existing) {
        this.flushCandle(existing).catch((err) =>
          logger.error(
            { err, pairId: existing.pairId },
            "Error persistiendo vela cerrada",
          ),
        );
      }
      this.inProgress.set(data.pairId, {
        pairId: data.pairId,
        bucketStart,
        open: ratio,
        high: ratio,
        low: ratio,
        close: ratio,
        sampleCount: 1,
      });
      return;
    }

    if (ratio > existing.high) existing.high = ratio;
    if (ratio < existing.low) existing.low = ratio;
    existing.close = ratio;
    existing.sampleCount++;
  }

  private async flushExpired(): Promise<void> {
    const now = Date.now();
    const toFlush: InProgressCandle[] = [];

    for (const [pairId, candle] of this.inProgress) {
      const bucketEnd = candle.bucketStart.getTime() + CANDLE_INTERVAL_MS;
      if (bucketEnd <= now) {
        toFlush.push(candle);
        this.inProgress.delete(pairId);
      }
    }

    for (const candle of toFlush) {
      await this.flushCandle(candle);
    }
  }

  private async flushAll(): Promise<void> {
    const all = Array.from(this.inProgress.values());
    this.inProgress.clear();
    for (const candle of all) {
      await this.flushCandle(candle);
    }
  }

  private async flushCandle(candle: InProgressCandle): Promise<void> {
    const closeTime = new Date(
      candle.bucketStart.getTime() + CANDLE_INTERVAL_MS,
    );

    try {
      // Upsert: si por algún motivo ya existe (reinicio + replay) sobrescribe.
      // El índice único (pairId, timeframe, openTime) garantiza una sola fila
      // por bucket.
      await OHLCVModel.updateOne(
        {
          pairId: candle.pairId,
          timeframe: "5m",
          openTime: candle.bucketStart,
        },
        {
          $set: {
            pairId: candle.pairId,
            timeframe: "5m",
            openTime: candle.bucketStart,
            closeTime,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: 0,
            sampleCount: candle.sampleCount,
          },
        },
        { upsert: true },
      );

      logger.debug(
        `Vela 5m cerrada: ${candle.pairId} ${candle.bucketStart.toISOString()} ` +
          `O=${candle.open.toFixed(4)} H=${candle.high.toFixed(4)} ` +
          `L=${candle.low.toFixed(4)} C=${candle.close.toFixed(4)} ` +
          `n=${candle.sampleCount}`,
      );
    } catch (err) {
      logger.error(
        { err, pairId: candle.pairId, bucketStart: candle.bucketStart },
        "Error al persistir vela 5m",
      );
    }
  }
}

export const candleBuilderService = new CandleBuilderService();
