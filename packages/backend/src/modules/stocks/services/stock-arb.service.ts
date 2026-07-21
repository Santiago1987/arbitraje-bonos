/**
 * StockArbService — arbitraje de acciones CI vs 24hs.
 *
 * Escucha los ticks de BYMA; cuando cambia una pata (CI o 24hs) de una acción
 * de la watchlist, recalcula diferencia / valor del pase / ganancia y emite
 * "stockarb:update" (el ws-server lo pushea al frontend por el canal "stocks").
 * Si cambia la tasa de caución (ticks PESOS_xD), recalcula toda la watchlist.
 *
 * Settings (watchlist y costo) viven en el doc singleton `stock_arb_settings`
 * y se cachean en memoria; `reload()` se llama al boot y en cada PUT.
 */
import type { StockArbUpdate } from "@arbitraje/shared";
import { StockArbSettingsModel, type StockArbSettings } from "../models.js";
import { eventBus } from "../../bonds/services/event-bus.js";
import { marketDataService } from "../../bonds/services/market-data.service.js";
import { bymaConnector } from "../../bonds/services/byma-connector.service.js";
import { logger } from "../../../utils/logger.js";

/** valorPase = mínimo de diferencia 24hs−CI para que el pase sea rentable. */
export function valorPase(
  bid24: number,
  tasaCaucion: number,
  costoCaucion: number,
  dias: number,
): number {
  return bid24 - bid24 / (1 + ((tasaCaucion + costoCaucion) / 365) * dias);
}

class StockArbService {
  private settings: StockArbSettings | null = null;
  private watched = new Set<string>();
  private tasaRawLogged = false;
  private lastCaucion: { tasa: number; dias: number } | null = null;

  /**
   * Tasa de caución en vivo: del ticker PESOS_xD de MENOR plazo con datos.
   * Un día común 1D siempre opera; viernes salta a 3D; feriado intermedio a 2D.
   * Cubre feriados sin calendario: si un plazo no opera, no llega su tick.
   */
  getTasaCaucion(): { tasa: number; dias: number } | null {
    for (let dias = 1; dias <= 4; dias++) {
      const raw = marketDataService.getPrice(`PESOS_${dias}D`);
      if (raw != null && raw > 0) {
        if (!this.tasaRawLogged) {
          this.tasaRawLogged = true;
          // TODO: verificar en vivo la unidad; asumimos TNA en % (ej. 29.5)
          logger.info(
            `Caución PESOS_${dias}D valor crudo: ${raw} (se usa ${raw / 100} como TNA decimal)`,
          );
        }
        return { tasa: raw / 100, dias };
      }
    }
    return null;
  }

  async init(): Promise<void> {
    await this.reload();
    eventBus.on("tick", ({ ticker }) => this.onTick(ticker));
    logger.info(
      `StockArbService inicializado con ${this.watched.size} acciones`,
    );
  }

  /** Recarga settings de la BD y re-sincroniza la suscripción al WS de BYMA. */
  async reload(): Promise<void> {
    this.settings = await this.getSettings();
    this.watched = new Set(this.settings.tickers);
    bymaConnector.setExtraTopics(
      this.settings.tickers.flatMap((t) => [
        `md.bm_MERV_${t}_CI`,
        `md.bm_MERV_${t}_24hs`,
      ]),
    );
  }

  async getSettings(): Promise<StockArbSettings> {
    return StockArbSettingsModel.findOneAndUpdate(
      { _id: "global" },
      {},
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
  }

  private onTick(ticker: string): void {
    // Tick de caución: si la tasa/días efectivos cambiaron, recalcular toda
    // la watchlist (los ticks de PESOS también llegan por volumen sin mover
    // la tasa; sin esta guarda serían cientos de mensajes inútiles).
    if (ticker.startsWith("PESOS_")) {
      const caucion = this.getTasaCaucion();
      if (
        caucion?.tasa === this.lastCaucion?.tasa &&
        caucion?.dias === this.lastCaucion?.dias
      ) {
        return;
      }
      this.lastCaucion = caucion;
      for (const base of this.watched) this.emitUpdate(base);
      return;
    }

    // Tick de una acción: viene como "GGAL_CI" / "GGAL_24hs"
    const sep = ticker.lastIndexOf("_");
    if (sep === -1) return;
    const base = ticker.slice(0, sep);
    if (!this.watched.has(base)) return;
    this.emitUpdate(base);
  }

  private emitUpdate(base: string): void {
    const update = this.computeUpdate(base);
    if (update) eventBus.emit("stockarb:update", update);
  }

  private computeUpdate(base: string): StockArbUpdate | null {
    if (!this.settings) return null;
    const s = this.settings;
    const ci = marketDataService.getBidAsk(`${base}_CI`);
    const h24 = marketDataService.getBidAsk(`${base}_24hs`);
    const caucion = this.getTasaCaucion();

    let diferencia: number | null = null;
    let pase: number | null = null;
    let ganancia: number | null = null;
    if (ci && h24) {
      // Arbitraje ejecutable: vendés 24hs al bid, comprás CI al ask
      diferencia = h24.bid - ci.ask;
      if (caucion) {
        pase = valorPase(h24.bid, caucion.tasa, s.costoCaucion, caucion.dias);
        ganancia = diferencia - pase;
      }
    }

    return {
      ticker: base,
      ci,
      h24,
      diferencia,
      valorPase: pase,
      ganancia,
      tasaCaucion: caucion?.tasa ?? null,
      diasCaucion: caucion?.dias ?? null,
      costoCaucion: s.costoCaucion,
      timestamp: new Date(),
    };
  }

  /** Foto actual de toda la watchlist — para el cliente que recién se suscribe. */
  getSnapshot(): StockArbUpdate[] {
    const updates: StockArbUpdate[] = [];
    for (const base of this.watched) {
      const update = this.computeUpdate(base);
      if (update) updates.push(update);
    }
    return updates;
  }
}

export const stockArbService = new StockArbService();
