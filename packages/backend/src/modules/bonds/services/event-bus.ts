import { EventEmitter } from "node:events";
import type { RawTickData, PairLiveData, AlertEvent } from "@arbitraje/shared";

// Definimos todos los eventos que pueden circular por el sistema
export interface AppEvents {
  // Un tick crudo llega de BYMA
  tick: {
    ticker: string;
    data: RawTickData;
    timestamp: Date;
  };

  // Un par se actualizó (ratio recalculado)
  "pair:update": PairLiveData;

  // Una alerta se disparó
  "alert:triggered": AlertEvent;

  // Snapshot guardado
  "snapshot:saved": {
    count: number;
    bondCount?: number;
    timestamp: Date;
  };

  // Estado de la conexión BYMA cambió
  "byma:status": { connected: boolean };
}

// EventEmitter tipado
class TypedEventEmitter {
  private emitter = new EventEmitter();

  constructor() {
    // Aumentamos el límite por defecto porque tenemos muchos listeners
    this.emitter.setMaxListeners(50);
  }

  on<K extends keyof AppEvents>(
    event: K,
    listener: (data: AppEvents[K]) => void,
  ): void {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
  }

  off<K extends keyof AppEvents>(
    event: K,
    listener: (data: AppEvents[K]) => void,
  ): void {
    this.emitter.off(event, listener as (...args: unknown[]) => void);
  }

  emit<K extends keyof AppEvents>(event: K, data: AppEvents[K]): void {
    this.emitter.emit(event, data);
  }

  once<K extends keyof AppEvents>(
    event: K,
    listener: (data: AppEvents[K]) => void,
  ): void {
    this.emitter.once(event, listener as (...args: unknown[]) => void);
  }
}

// Singleton - un solo bus para toda la app
export const eventBus = new TypedEventEmitter();
