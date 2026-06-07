/**
 * StocksSnapshotService
 *
 * Baja las cotizaciones de acciones argentinas de IOL una vez al día, al
 * cierre de la rueda (STOCKS_FETCH_TIME, default 17:00 hora de sesión), y las
 * persiste en `Arg_Stock` con upsert por símbolo+plazo+día (idempotente).
 *
 * Scheduling: no usamos cron externo. Calculamos los ms hasta el próximo
 * horario objetivo en la timezone de sesión y nos re-agendamos tras cada
 * corrida (mismo estilo start()/stop() que el resto de los servicios).
 */

import { config } from "../../../config/index.js";
import { logger } from "../../../utils/logger.js";
import {
  getSessionConfig,
  getLocalDateKey,
  getLocalMinutes,
  msUntilNextLocalTime,
} from "../../../utils/session.js";
import { iolStocksConnector } from "../iol-stocks.connector.js";
import { ArgStockModel } from "../models.js";

class StocksSnapshotService {
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private isRunning = false;

  start(): void {
    if (this.isRunning) return;
    if (!config.STOCKS_FETCH_ENABLED) {
      logger.info("StocksSnapshotService deshabilitado (STOCKS_FETCH_ENABLED)");
      return;
    }
    this.isRunning = true;
    // Si el backend estuvo caído a la hora de cierre, recuperamos el día.
    this.catchUpIfMissed().catch((err) =>
      logger.error({ err }, "Error en catch-up de acciones"),
    );
    this.scheduleNext();
  }

  /**
   * Recupera el snapshot del día si ya pasó la hora de cierre y todavía no
   * está guardado (p.ej. el backend estaba caído a las 17h). Idempotente.
   */
  private async catchUpIfMissed(): Promise<void> {
    const { timezone } = getSessionConfig();
    const nowMin = getLocalMinutes(new Date(), timezone);
    const [h, m] = config.STOCKS_FETCH_TIME.split(":").map(Number);
    if (nowMin < h * 60 + m) return; // todavía no pasó la hora de hoy

    const today = getLocalDateKey(new Date(), timezone);
    if (await ArgStockModel.exists({ date: today })) return; // ya está

    logger.info(`[stocks] Catch-up: falta snapshot de ${today}, bajando ahora`);
    await this.fetchAndStore();
  }

  stop(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.isRunning = false;
    logger.info("StocksSnapshotService detenido");
  }

  private scheduleNext(): void {
    const { timezone } = getSessionConfig();
    const delay = msUntilNextLocalTime(config.STOCKS_FETCH_TIME, timezone);
    const at = new Date(Date.now() + delay);
    logger.info(
      `StocksSnapshotService: próxima corrida ${at.toISOString()} (${config.STOCKS_FETCH_TIME} ${timezone}, en ${Math.round(delay / 60_000)} min)`,
    );
    this.timeoutId = setTimeout(() => {
      this.fetchAndStore()
        .catch((err) =>
          logger.error({ err }, "Error en snapshot diario de acciones"),
        )
        .finally(() => {
          if (this.isRunning) this.scheduleNext();
        });
    }, delay);
  }

  /**
   * Baja acciones de IOL y hace upsert en `Arg_Stock`. Idempotente:
   * re-correrlo el mismo día sobrescribe las filas del día.
   * Público para poder dispararlo manualmente desde una ruta de test.
   */
  async fetchAndStore(): Promise<{ count: number }> {
    const { timezone } = getSessionConfig();
    const stocks = await iolStocksConnector.getAllStocks();
    if (stocks.length === 0) {
      logger.warn("[stocks] IOL devolvió 0 acciones");
      return { count: 0 };
    }

    const bulkOps = stocks.map((s) => {
      const date = getLocalDateKey(s.fecha, timezone);
      return {
        updateOne: {
          filter: { simbolo: s.simbolo, plazo: s.plazo, date },
          update: { $set: { ...s, date } },
          upsert: true,
        },
      };
    });

    await ArgStockModel.bulkWrite(bulkOps);
    logger.info(`[stocks] Snapshot diario: ${bulkOps.length} acciones guardadas`);
    return { count: bulkOps.length };
  }
}

export const stocksSnapshotService = new StocksSnapshotService();
