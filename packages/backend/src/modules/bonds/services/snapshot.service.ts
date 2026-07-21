import { config } from "../../../config/index.js";
import {
  PairSnapshotModel,
  BondPairModel,
  BondModel,
  BondSnapshotModel,
} from "../models.js";
import { marketDataService } from "./market-data.service.js";
import { eventBus } from "./event-bus.js";
import { logger } from "../../../utils/logger.js";
import { getSessionPhase } from "../../../utils/session.js";

/**
 * SnapshotService
 *
 * Cada N segundos (configurable), toma una foto del estado actual
 * de todos los pares y la persiste en MongoDB con bulkWrite.
 */
class SnapshotService {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.intervalId = setInterval(
      () => this.takeSnapshot(),
      config.SNAPSHOT_INTERVAL_MS,
    );

    logger.info(
      `SnapshotService iniciado - guardando cada ${config.SNAPSHOT_INTERVAL_MS / 1000}s`,
    );
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info("SnapshotService detenido");
  }

  /**
   * Toma una foto del estado actual y la persiste.
   */
  private async takeSnapshot(): Promise<void> {
    // ponytail: si no llegó un tick en el último intervalo, lo que hay en RAM
    // es una foto vieja (rueda cerrada o BYMA caído) → no persistir duplicados.
    const lastTickAt = marketDataService.getStats().lastTickAt;
    if (
      !lastTickAt ||
      Date.now() - lastTickAt.getTime() > config.SNAPSHOT_INTERVAL_MS
    ) {
      return;
    }

    try {
      const [pairs, bonds] = await Promise.all([
        BondPairModel.find({ isActive: true }).lean(),
        BondModel.find().lean(),
      ]);

      const activeBondByFullTicker = new Map<string, string>(
        bonds.map((bond) => [bond.fullTicker, bond._id.toString()]),
      );

      const now = new Date();
      const sessionPhase = getSessionPhase(now);
      const pairOperations = [];
      const bondOperations = [];
      const activeBondTickers = new Set(activeBondByFullTicker.keys());

      for (const pair of pairs) {
        const tickerA = `${pair.bondA}_${pair.settlementA}`;
        const tickerB = `${pair.bondB}_${pair.settlementB}`;

        const priceA = marketDataService.getPrice(tickerA);
        const priceB = marketDataService.getPrice(tickerB);

        // Solo guardamos si tenemos datos de ambas patas
        if (priceA === null || priceB === null || priceB === 0) continue;

        const latestA = marketDataService.getLatest(tickerA);
        const latestB = marketDataService.getLatest(tickerB);

        pairOperations.push({
          insertOne: {
            document: {
              pairId: pair._id.toString(),
              timestamp: now,
              priceA,
              priceB,
              ratio: priceA / priceB,
              spread: priceA - priceB,
              volumeA: latestA ? parseFloat(latestA.data.vol_nom) || 0 : 0,
              volumeB: latestB ? parseFloat(latestB.data.vol_nom) || 0 : 0,
              sessionPhase,
            },
          },
        });
      }

      for (const ticker of marketDataService.getAllTickers()) {
        if (!activeBondTickers.has(ticker)) continue;

        const latest = marketDataService.getLatest(ticker);
        if (!latest) continue;

        const price = marketDataService.getPrice(ticker);
        if (price === null) continue;

        const bidAsk = marketDataService.getBidAsk(ticker);
        const bondId = activeBondByFullTicker.get(ticker);
        if (!bondId) continue;

        bondOperations.push({
          insertOne: {
            document: {
              bondId,
              fullTicker: ticker,
              ticker: ticker.split("_")[0],
              timestamp: now,
              price,
              bid: bidAsk?.bid,
              ask: bidAsk?.ask,
              volumeNominal: parseFloat(latest.data.vol_nom) || 0,
              volumeInter: parseFloat(latest.data.vol_inter) || 0,
              raw: latest.data,
              sessionPhase,
            },
          },
        });
      }

      const writePromises = [];
      if (pairOperations.length > 0) {
        writePromises.push(PairSnapshotModel.bulkWrite(pairOperations));
      }
      if (bondOperations.length > 0) {
        writePromises.push(BondSnapshotModel.bulkWrite(bondOperations));
      }

      if (writePromises.length > 0) {
        await Promise.all(writePromises);

        eventBus.emit("snapshot:saved", {
          count: pairOperations.length + bondOperations.length,
          bondCount: bondOperations.length,
          timestamp: now,
        });

        logger.debug(
          `Snapshot guardado: ${pairOperations.length} pares, ${bondOperations.length} bonos`,
        );
      }
    } catch (error) {
      logger.error({ error }, "Error al tomar snapshot");
    }
  }
}

export const snapshotService = new SnapshotService();
