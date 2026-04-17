import type { PairStatistics, StatsWindow } from '@arbitraje/shared';
import { PairSnapshotModel, BondPairModel } from '../models/index.js';
import { pairCalculatorService } from './pair-calculator.service.js';
import { logger } from '../utils/logger.js';

// Mapeo de ventana a milisegundos
const WINDOW_MS: Record<StatsWindow, number> = {
  '1w': 7 * 24 * 60 * 60 * 1000,
  '2w': 14 * 24 * 60 * 60 * 1000,
  '1m': 30 * 24 * 60 * 60 * 1000,
  '3m': 90 * 24 * 60 * 60 * 1000,
  '6m': 180 * 24 * 60 * 60 * 1000,
  '1y': 365 * 24 * 60 * 60 * 1000,
};

/**
 * StatisticsService
 *
 * Calcula estadísticas descriptivas de los pares usando
 * la data histórica de snapshots en MongoDB.
 */
class StatisticsService {
  /**
   * Calcula estadísticas de un par para una ventana temporal.
   */
  async getStats(pairId: string, window: StatsWindow): Promise<PairStatistics | null> {
    const pair = await BondPairModel.findById(pairId).lean();
    if (!pair) return null;

    const since = new Date(Date.now() - WINDOW_MS[window]);

    // Usamos aggregation pipeline para eficiencia.
    // Ignoramos warmup/cooldown/pre_open/post_close: los primeros y últimos
    // minutos de la rueda son ruidosos en mercados chicos y distorsionan los
    // promedios (ver CLAUDE.md / decisión de sesión).
    const [result] = await PairSnapshotModel.aggregate([
      {
        $match: {
          pairId,
          sessionPhase: "regular",
          timestamp: { $gte: since },
        },
      },
      {
        $group: {
          _id: null,
          mean: { $avg: '$ratio' },
          min: { $min: '$ratio' },
          max: { $max: '$ratio' },
          count: { $sum: 1 },
          // Necesitamos los valores individuales para calcular mediana y stdDev
          ratios: { $push: '$ratio' },
        },
      },
    ]);

    if (!result || result.count === 0) return null;

    const ratios: number[] = result.ratios.sort((a: number, b: number) => a - b);
    const mean = result.mean;
    const median = this.calcMedian(ratios);
    const stdDev = this.calcStdDev(ratios, mean);

    // Obtener ratio actual del live data
    const liveData = pairCalculatorService.getLiveData(pairId);
    const currentRatio = liveData?.currentRatio ?? ratios[ratios.length - 1];

    // Z-Score: cuántos desvíos estándar del promedio
    const zScore = stdDev > 0 ? (currentRatio - mean) / stdDev : 0;

    // Percentil: qué % de los datos históricos están por debajo del valor actual
    const belowCount = ratios.filter((r: number) => r < currentRatio).length;
    const percentile = (belowCount / ratios.length) * 100;

    return {
      pairId,
      pairName: pair.name,
      window,
      mean,
      median,
      stdDev,
      min: result.min,
      max: result.max,
      currentRatio,
      zScore,
      percentile,
      sampleCount: result.count,
      calculatedAt: new Date(),
    };
  }

  /**
   * Estadísticas de todos los pares activos para una ventana.
   */
  async getAllStats(window: StatsWindow): Promise<PairStatistics[]> {
    const pairs = await BondPairModel.find({ isActive: true }).lean();
    const results = await Promise.all(
      pairs.map((p) => this.getStats(p._id.toString(), window))
    );
    return results.filter((r): r is PairStatistics => r !== null);
  }

  private calcMedian(sorted: number[]): number {
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
  }

  private calcStdDev(values: number[], mean: number): number {
    if (values.length < 2) return 0;
    const squaredDiffs = values.map((v) => (v - mean) ** 2);
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (values.length - 1);
    return Math.sqrt(variance);
  }
}

export const statisticsService = new StatisticsService();
