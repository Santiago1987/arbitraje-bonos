import type { BondPair, PairLiveData } from "@arbitraje/shared";
import { eventBus } from "./event-bus.js";
import { marketDataService } from "./market-data.service.js";
import { BondPairModel } from "../models.js";
import { logger } from "../../../utils/logger.js";

/**
 * PairCalculatorService
 *
 * Escucha cada tick y recalcula los ratios de todos los pares
 * que involucren ese ticker. Todo en memoria, sin tocar Mongo.
 */
class PairCalculatorService {
  // Cache de pares activos
  private pairs: BondPair[] = [];

  // Último dato calculado por par
  private liveData = new Map<string, PairLiveData>();

  // Lookup: ticker -> pares que lo usan
  private tickerToPairs = new Map<string, BondPair[]>();

  async init(): Promise<void> {
    await this.loadPairs();
    this.subscribeToTicks();
    logger.info(`PairCalculator inicializado con ${this.pairs.length} pares`);
  }

  /**
   * Carga los pares activos de la BD y arma el índice inverso.
   */
  async loadPairs(): Promise<void> {
    const docs = await BondPairModel.find({ isActive: true }).lean();
    this.pairs = docs.map((d) => ({
      id: d._id.toString(),
      name: d.name,
      bondA: d.bondA,
      bondB: d.bondB,
      settlementA: d.settlementA,
      settlementB: d.settlementB,
      type: d.type,
      isActive: d.isActive,
      createdAt: d.createdAt,
    }));

    // Armamos el índice inverso: para cada ticker, qué pares lo usan
    this.tickerToPairs.clear();
    for (const pair of this.pairs) {
      const tickerA = `${pair.bondA}_${pair.settlementA}`;
      const tickerB = `${pair.bondB}_${pair.settlementB}`;

      for (const ticker of [tickerA, tickerB]) {
        const existing = this.tickerToPairs.get(ticker) ?? [];
        existing.push(pair);
        this.tickerToPairs.set(ticker, existing);
      }
    }
  }

  /**
   * Escucha los ticks y recalcula los pares afectados.
   */
  private subscribeToTicks(): void {
    eventBus.on("tick", ({ ticker }) => {
      const affectedPairs = this.tickerToPairs.get(ticker);
      if (!affectedPairs) return;

      for (const pair of affectedPairs) {
        this.recalculate(pair);
      }
    });
  }

  /**
   * Recalcula el ratio/spread de un par y emite el evento.
   */
  private recalculate(pair: BondPair): void {
    const tickerA = `${pair.bondA}_${pair.settlementA}`;
    const tickerB = `${pair.bondB}_${pair.settlementB}`;

    const priceA = marketDataService.getPrice(tickerA);
    const priceB = marketDataService.getPrice(tickerB);

    // Si no tenemos precio de alguna pata, no podemos calcular
    if (priceA === null || priceB === null || priceB === 0) return;

    const bidAskA = marketDataService.getBidAsk(tickerA);
    const bidAskB = marketDataService.getBidAsk(tickerB);

    const currentRatio = priceA / priceB;

    // Calcular cambio % vs dato anterior (si existe)
    const prev = this.liveData.get(pair.id);
    const changePercent = prev
      ? ((currentRatio - prev.currentRatio) / prev.currentRatio) * 100
      : 0;

    const liveData: PairLiveData = {
      pairId: pair.id,
      pairName: pair.name,
      currentRatio,
      priceA,
      priceB,
      bidA: bidAskA?.bid ?? 0,
      askA: bidAskA?.ask ?? 0,
      bidB: bidAskB?.bid ?? 0,
      askB: bidAskB?.ask ?? 0,
      changePercent,
      timestamp: new Date(),
    };

    this.liveData.set(pair.id, liveData);

    // Emitimos para que AlertEngine y WebSocket reaccionen
    eventBus.emit("pair:update", liveData);
  }

  /**
   * Obtiene el dato en vivo de un par.
   */
  getLiveData(pairId: string): PairLiveData | undefined {
    return this.liveData.get(pairId);
  }

  /**
   * Obtiene los datos en vivo de todos los pares.
   */
  getAllLiveData(): PairLiveData[] {
    return Array.from(this.liveData.values());
  }

  /**
   * Recarga los pares (llamar cuando se crea/edita/borra un par).
   */
  async reloadPairs(): Promise<void> {
    await this.loadPairs();
    logger.info(`Pares recargados: ${this.pairs.length} activos`);
  }
}

export const pairCalculatorService = new PairCalculatorService();
