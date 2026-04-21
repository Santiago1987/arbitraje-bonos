import type {
  AlertConfig,
  AlertEvent,
  AlertField,
  PairLiveData,
} from '@arbitraje/shared';
import { AlertConfigModel } from '../models/index.js';
import { eventBus } from './event-bus.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

function extractFieldValue(
  field: AlertField,
  liveData: PairLiveData,
): number {
  switch (field) {
    case 'ratio':
      return liveData.currentRatio;
    case 'spread':
      return liveData.priceA - liveData.priceB;
    case 'priceA':
      return liveData.priceA;
    case 'priceB':
      return liveData.priceB;
  }
}

/**
 * AlertEngine
 *
 * Escucha actualizaciones de pares y evalúa si alguna alerta
 * configurada se debe disparar. Incluye cooldown para no spamear.
 */
class AlertEngine {
  // Cache de alertas activas agrupadas por pairId
  private alertsByPair = new Map<string, AlertConfig[]>();

  // Cooldown: alertId -> timestamp del último disparo
  private cooldowns = new Map<string, number>();

  // Valores anteriores para detectar cruces (cross_above/cross_below).
  // Indexado por `${pairId}:${field}` porque distintas alertas del mismo
  // par pueden mirar campos distintos (ratio, spread, priceA, priceB).
  private previousValues = new Map<string, number>();

  async init(): Promise<void> {
    await this.loadAlerts();
    this.subscribeToUpdates();
    logger.info(`AlertEngine inicializado con ${this.getTotalAlerts()} alertas activas`);
  }

  /**
   * Carga las alertas activas de la BD.
   */
  async loadAlerts(): Promise<void> {
    const alerts = await AlertConfigModel.find({ status: 'active' }).lean();

    this.alertsByPair.clear();
    for (const alert of alerts) {
      const alertConfig: AlertConfig = {
        id: alert._id.toString(),
        pairId: alert.pairId,
        pairName: alert.pairName,
        field: alert.field ?? 'ratio',
        condition: alert.condition,
        threshold: alert.threshold,
        message: alert.message,
        status: alert.status,
        createdAt: alert.createdAt,
        triggeredAt: alert.triggeredAt,
      };

      const existing = this.alertsByPair.get(alert.pairId) ?? [];
      existing.push(alertConfig);
      this.alertsByPair.set(alert.pairId, existing);
    }
  }

  /**
   * Escucha actualizaciones de pares y evalúa alertas.
   */
  private subscribeToUpdates(): void {
    eventBus.on('pair:update', (liveData: PairLiveData) => {
      const alerts = this.alertsByPair.get(liveData.pairId);
      if (!alerts || alerts.length === 0) return;

      // Trackeamos un valor previo distinto por field para que los cruces
      // funcionen aun si hay alertas mirando campos distintos del mismo par.
      const seenFields = new Set<AlertField>();

      for (const alert of alerts) {
        this.evaluate(alert, liveData);
        seenFields.add(alert.field);
      }

      for (const field of seenFields) {
        this.previousValues.set(
          `${liveData.pairId}:${field}`,
          extractFieldValue(field, liveData),
        );
      }
    });
  }

  /**
   * Evalúa si una alerta debe dispararse.
   */
  private evaluate(alert: AlertConfig, liveData: PairLiveData): void {
    const value = extractFieldValue(alert.field, liveData);
    const { threshold, condition } = alert;
    const prevKey = `${liveData.pairId}:${alert.field}`;
    let shouldTrigger = false;

    switch (condition) {
      case 'above':
        shouldTrigger = value > threshold;
        break;

      case 'below':
        shouldTrigger = value < threshold;
        break;

      case 'cross_above': {
        const prev = this.previousValues.get(prevKey);
        shouldTrigger = prev !== undefined && prev <= threshold && value > threshold;
        break;
      }

      case 'cross_below': {
        const prev = this.previousValues.get(prevKey);
        shouldTrigger = prev !== undefined && prev >= threshold && value < threshold;
        break;
      }
    }

    if (shouldTrigger && !this.isInCooldown(alert.id)) {
      this.trigger(alert, liveData, value);
    }
  }

  /**
   * Dispara una alerta.
   */
  private trigger(
    alert: AlertConfig,
    liveData: PairLiveData,
    currentValue: number,
  ): void {
    const event: AlertEvent = {
      alertId: alert.id,
      pairId: alert.pairId,
      pairName: alert.pairName,
      field: alert.field,
      condition: alert.condition,
      threshold: alert.threshold,
      currentValue,
      message:
        alert.message ??
        `${alert.pairName}: ${alert.field} ${currentValue.toFixed(4)} ${alert.condition} ${alert.threshold}`,
      timestamp: new Date(),
    };

    // Registrar cooldown
    this.cooldowns.set(alert.id, Date.now());

    // Emitir evento
    eventBus.emit('alert:triggered', event);

    // Actualizar en BD (fire and forget)
    AlertConfigModel.findByIdAndUpdate(alert.id, {
      status: 'triggered',
      triggeredAt: event.timestamp,
    }).catch((err) => logger.error({ err }, 'Error actualizando alerta en BD'));

    logger.info(
      { alertId: alert.id, pair: alert.pairName, value: liveData.currentRatio },
      'Alerta disparada'
    );
  }

  /**
   * Verifica si una alerta está en período de cooldown.
   */
  private isInCooldown(alertId: string): boolean {
    const lastTriggered = this.cooldowns.get(alertId);
    if (!lastTriggered) return false;
    return Date.now() - lastTriggered < config.ALERT_COOLDOWN_MS;
  }

  private getTotalAlerts(): number {
    let total = 0;
    for (const alerts of this.alertsByPair.values()) {
      total += alerts.length;
    }
    return total;
  }

  /**
   * Recarga alertas (llamar cuando se crea/edita/borra una alerta).
   */
  async reloadAlerts(): Promise<void> {
    await this.loadAlerts();
    logger.info(`Alertas recargadas: ${this.getTotalAlerts()} activas`);
  }
}

export const alertEngine = new AlertEngine();
