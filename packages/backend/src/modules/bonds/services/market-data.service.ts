import type { RawTickData } from "@arbitraje/shared";
import { eventBus } from "./event-bus.js";
import { logger } from "../../../utils/logger.js";

// Store en memoria: último tick por ticker
interface TickEntry {
  ticker: string;
  data: RawTickData;
  timestamp: Date;
  receivedAt: Date;
}

/**
 * MarketDataService
 *
 * Responsabilidades:
 * - Mantener en memoria el último tick de cada bono
 * - Emitir eventos 'tick' para que otros servicios reaccionen
 * - Proveer acceso rápido al precio actual de cualquier bono
 *
 * NO se encarga de:
 * - Conectar con BYMA (eso lo hace BymaConnector)
 * - Persistir datos (eso lo hace SnapshotService)
 * - Calcular ratios (eso lo hace PairCalculator)
 */
class MarketDataService {
  // Map<ticker, último tick>
  private store = new Map<string, TickEntry>();

  // Contadores para métricas
  private tickCount = 0;
  private lastTickAt: Date | null = null;

  /**
   * Procesa un tick entrante.
   * Llamado por BymaConnector cada vez que llega un mensaje FIX.
   */
  processTick(ticker: string, data: RawTickData): void {
    const now = new Date();

    const entry: TickEntry = {
      ticker,
      data,
      timestamp: data.time_ult_oper ? new Date(data.time_ult_oper) : now,
      receivedAt: now,
    };

    // Sobrescribimos el anterior (solo nos interesa el último)
    this.store.set(ticker, entry);
    this.tickCount++;
    this.lastTickAt = now;

    // Emitimos el evento para que los demás servicios reaccionen
    eventBus.emit("tick", {
      ticker,
      data,
      timestamp: entry.timestamp,
    });
  }

  /**
   * Obtiene el último tick de un bono.
   */
  getLatest(ticker: string): TickEntry | undefined {
    return this.store.get(ticker);
  }

  /**
   * Obtiene el precio actual (último operado) de un bono.
   * Retorna null si no tenemos datos.
   */
  getPrice(ticker: string): number | null {
    const entry = this.store.get(ticker);
    if (!entry) return null;
    const price = parseFloat(entry.data.prc_act);
    return isNaN(price) ? null : price;
  }

  /**
   * Obtiene bid y ask de un bono.
   */
  getBidAsk(ticker: string): { bid: number; ask: number } | null {
    const entry = this.store.get(ticker);
    if (!entry) return null;

    const bid = parseFloat(entry.data.prc_comp);
    const ask = parseFloat(entry.data.prc_venta);

    if (isNaN(bid) || isNaN(ask)) return null;
    return { bid, ask };
  }

  /**
   * Obtiene todos los tickers que tenemos en memoria.
   */
  getAllTickers(): string[] {
    return Array.from(this.store.keys());
  }

  /**
   * Retorna un snapshot completo del store (para persistencia).
   */
  getSnapshot(): Map<string, TickEntry> {
    return new Map(this.store);
  }

  /**
   * Métricas del servicio.
   */
  getStats() {
    return {
      tickersTracked: this.store.size,
      totalTicksProcessed: this.tickCount,
      lastTickAt: this.lastTickAt,
    };
  }
}

// Singleton
export const marketDataService = new MarketDataService();
