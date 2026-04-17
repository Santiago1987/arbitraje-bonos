import type { AlertConfig, AlertEvent, PairLiveData } from '@arbitraje/shared';
import { AlertConfigModel } from '../models/index.js';
import { eventBus } from './event-bus.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

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

  // Valores anteriores para detectar cruces (cross_above/cross_below)
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

      for (const alert of alerts) {
        this.evaluate(alert, liveData);
      }

      // Guardamos el valor actual para detectar cruces en el próximo tick
      this.previousValues.set(liveData.pairId, liveData.currentRatio);
    });
  }

  /**
   * Evalúa si una alerta debe dispararse.
   */
  private evaluate(alert: AlertConfig, liveData: PairLiveData): void {
    const { currentRatio } = liveData;
    const { threshold, condition } = alert;
    let shouldTrigger = false;

    switch (condition) {
      case 'above':
        shouldTrigger = currentRatio > threshold;
        break;

      case 'below':
        shouldTrigger = currentRatio < threshold;
        break;

      case 'cross_above': {
        const prev = this.previousValues.get(liveData.pairId);
        shouldTrigger = prev !== undefined && prev <= threshold && currentRatio > threshold;
        break;
      }

      case 'cross_below': {
        const prev = this.previousValues.get(liveData.pairId);
        shouldTrigger = prev !== undefined && prev >= threshold && currentRatio < threshold;
        break;
      }
    }

    if (shouldTrigger && !this.isInCooldown(alert.id)) {
      this.trigger(alert, liveData);
    }
  }

  /**
   * Dispara una alerta.
   */
  private trigger(alert: AlertConfig, liveData: PairLiveData): void {
    const event: AlertEvent = {
      alertId: alert.id,
      pairId: alert.pairId,
      pairName: alert.pairName,
      condition: alert.condition,
      threshold: alert.threshold,
      currentValue: liveData.currentRatio,
      message:
        alert.message ??
        `${alert.pairName}: ratio ${liveData.currentRatio.toFixed(4)} ${alert.condition} ${alert.threshold}`,
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
