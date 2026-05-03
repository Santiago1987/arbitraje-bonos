import type { PairSummary } from "@arbitraje/shared";
import { BondPairModel, PairDailyModel } from "../models/index.js";
import { getLocalDateKey, getSessionConfig } from "../utils/session.js";

/**
 * PairSummaryService
 *
 * Calcula referencias por par desde `pair_daily` para la tabla principal:
 * promedio de la rueda anterior (`avgClose` del último día con datos),
 * promedios 1w/1m (promedio simple del VWAP diario) y rango mensual
 * (mínimo/máximo intradiario). Excluye el día corriente — los promedios
 * sólo se mueven entre ruedas.
 *
 * Ventanas por calendario (7/30 días). Findes y feriados quedan
 * naturalmente afuera porque `pair_daily` sólo tiene fila para días con
 * snapshots `regular`.
 */
class PairSummaryService {
  async getAllSummaries(): Promise<PairSummary[]> {
    const cfg = getSessionConfig();
    const now = new Date();
    const todayKey = getLocalDateKey(now, cfg.timezone);

    const dayMs = 24 * 60 * 60 * 1000;
    const cutoff1w = getLocalDateKey(
      new Date(now.getTime() - 7 * dayMs),
      cfg.timezone,
    );
    const cutoff1m = getLocalDateKey(
      new Date(now.getTime() - 30 * dayMs),
      cfg.timezone,
    );

    const pairs = await BondPairModel.find({ isActive: true }).lean();
    if (pairs.length === 0) return [];

    const pairIds = pairs.map((p) => p._id.toString());

    // Traemos las filas de los últimos 30 días (excluyendo hoy) en una sola
    // query y agrupamos en memoria. `pair_daily.date` es "YYYY-MM-DD" así que
    // la comparación lexicográfica es correcta.
    const rows = await PairDailyModel.find({
      pairId: { $in: pairIds },
      date: { $gte: cutoff1m, $lt: todayKey },
    })
      .select({
        pairId: 1,
        date: 1,
        vwap: 1,
        avgClose: 1,
        high: 1,
        low: 1,
        _id: 0,
      })
      .lean();

    const byPair = new Map<
      string,
      Array<{
        date: string;
        vwap: number;
        avgClose: number;
        high: number;
        low: number;
      }>
    >();
    for (const row of rows) {
      const arr = byPair.get(row.pairId) ?? [];
      arr.push({
        date: row.date,
        vwap: row.vwap,
        avgClose: row.avgClose,
        high: row.high,
        low: row.low,
      });
      byPair.set(row.pairId, arr);
    }

    return pairIds.map((pairId) => {
      const days = byPair.get(pairId) ?? [];
      const days1w = days.filter((d) => d.date >= cutoff1w);
      const days1m = days;

      const avg = (
        arr: Array<{ vwap: number }>,
      ): number | null => {
        if (arr.length === 0) return null;
        return arr.reduce((s, r) => s + r.vwap, 0) / arr.length;
      };

      // Última rueda con datos: la fila más reciente (excluyendo hoy).
      let prevDay: { date: string; avgClose: number } | null = null;
      for (const d of days) {
        if (prevDay === null || d.date > prevDay.date) prevDay = d;
      }

      let min1m: number | null = null;
      let max1m: number | null = null;
      for (const d of days1m) {
        if (min1m === null || d.low < min1m) min1m = d.low;
        if (max1m === null || d.high > max1m) max1m = d.high;
      }

      return {
        pairId,
        avgPrev: prevDay?.avgClose ?? null,
        avg1w: avg(days1w),
        avg1m: avg(days1m),
        min1m,
        max1m,
        sampleCount1w: days1w.length,
        sampleCount1m: days1m.length,
        calculatedAt: now,
      };
    });
  }
}

export const pairSummaryService = new PairSummaryService();
