import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type {
  WSMessage,
  WSSubscribePayload,
  AlertEvent,
  PairLiveData,
} from "@arbitraje/shared";
import { eventBus } from "./services/event-bus.js";
import { bymaConnector } from "./services/byma-connector.service.js";
import { logger } from "../../utils/logger.js";

interface ClientState {
  ws: WebSocket;
  subscribedPairs: Set<string>;
  subscribedAlerts: boolean;
  lastActivity: number;
}

/**
 * WebSocket Server para el frontend.
 *
 * Canales:
 * - 'pairs': actualizaciones de ratios en tiempo real
 * - 'alerts': alertas disparadas
 *
 * El cliente se suscribe/desuscribe enviando mensajes:
 * { type: 'subscribe', payload: { channel: 'pairs', pairIds: ['...'] } }
 * { type: 'subscribe', payload: { channel: 'alerts' } }
 */
class WSServer {
  private clients = new Map<string, ClientState>();
  private clientIdCounter = 0;

  /**
   * Registra las rutas de WebSocket en Fastify.
   */
  register(app: FastifyInstance): void {
    app.get("/ws", { websocket: true }, (socket, _req) => {
      const clientId = `client_${++this.clientIdCounter}`;

      const state: ClientState = {
        ws: socket,
        subscribedPairs: new Set(),
        subscribedAlerts: false,
        lastActivity: Date.now(),
      };

      this.clients.set(clientId, state);
      //logger.info({ clientId }, 'Cliente WS conectado');

      socket.on("message", (raw) => {
        try {
          const msg: WSMessage = JSON.parse(raw.toString());
          state.lastActivity = Date.now();
          this.handleClientMessage(clientId, state, msg);
        } catch {
          logger.warn({ clientId }, "Mensaje WS inválido");
        }
      });

      socket.on("close", () => {
        this.clients.delete(clientId);
        //logger.info({ clientId }, 'Cliente WS desconectado');
      });

      socket.on("error", (err) => {
        logger.error({ clientId, err }, "Error en cliente WS");
        this.clients.delete(clientId);
      });

      // Enviar heartbeat de bienvenida
      this.send(socket, {
        type: "heartbeat",
        payload: { clientId },
        timestamp: new Date(),
      });

      // Enviar estado actual de BYMA al nuevo cliente
      this.send(socket, {
        type: "byma_status",
        payload: { connected: bymaConnector.getStatus().connected },
        timestamp: new Date(),
      });
    });

    // Suscribirse a eventos del bus
    this.subscribeToEvents();

    // Heartbeat periódico para limpiar clientes muertos
    setInterval(() => this.cleanupStaleClients(), 60_000);

    logger.info("WebSocket server registrado en /ws");
  }

  /**
   * Maneja mensajes del cliente (subscribe/unsubscribe).
   */
  private handleClientMessage(
    clientId: string,
    state: ClientState,
    msg: WSMessage,
  ): void {
    switch (msg.type) {
      case "subscribe": {
        const payload = msg.payload as WSSubscribePayload;
        if (payload.channel === "pairs" && payload.pairIds) {
          for (const id of payload.pairIds) {
            state.subscribedPairs.add(id);
          }
          logger.debug(
            { clientId, pairIds: payload.pairIds },
            "Suscrito a pares",
          );
        } else if (payload.channel === "alerts") {
          state.subscribedAlerts = true;
          logger.debug({ clientId }, "Suscrito a alertas");
        }
        break;
      }

      case "unsubscribe": {
        const payload = msg.payload as WSSubscribePayload;
        if (payload.channel === "pairs" && payload.pairIds) {
          for (const id of payload.pairIds) {
            state.subscribedPairs.delete(id);
          }
        } else if (payload.channel === "alerts") {
          state.subscribedAlerts = false;
        }
        break;
      }

      case "heartbeat":
        // El cliente confirma que sigue vivo
        break;

      default:
        logger.warn(
          { clientId, type: msg.type },
          "Tipo de mensaje WS desconocido",
        );
    }
  }

  /**
   * Escucha los eventos internos y los distribuye a los clientes.
   */
  private subscribeToEvents(): void {
    // Actualizaciones de pares -> solo a clientes suscritos a ese par
    eventBus.on("pair:update", (liveData: PairLiveData) => {
      const msg: WSMessage<PairLiveData> = {
        type: "pair_update",
        payload: liveData,
        timestamp: new Date(),
      };

      for (const [, state] of this.clients) {
        if (state.subscribedPairs.has(liveData.pairId)) {
          this.send(state.ws, msg);
        }
      }
    });

    // Alertas -> a todos los clientes suscritos a alertas
    eventBus.on("alert:triggered", (alert: AlertEvent) => {
      const msg: WSMessage<AlertEvent> = {
        type: "alert_triggered",
        payload: alert,
        timestamp: new Date(),
      };

      for (const [, state] of this.clients) {
        if (state.subscribedAlerts) {
          this.send(state.ws, msg);
        }
      }
    });

    // Estado de conexión BYMA -> broadcast a todos los clientes
    eventBus.on("byma:status", ({ connected }) => {
      const msg: WSMessage<{ connected: boolean }> = {
        type: "byma_status",
        payload: { connected },
        timestamp: new Date(),
      };
      for (const [, state] of this.clients) {
        this.send(state.ws, msg);
      }
    });
  }

  /**
   * Envía un mensaje a un cliente.
   */
  private send(ws: WebSocket, msg: WSMessage): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Limpia clientes que no responden.
   */
  private cleanupStaleClients(): void {
    const staleThreshold = 5 * 60 * 1000; // 5 minutos sin actividad
    const now = Date.now();

    for (const [clientId, state] of this.clients) {
      if (now - state.lastActivity > staleThreshold) {
        state.ws.close();
        this.clients.delete(clientId);
        logger.info({ clientId }, "Cliente WS stale eliminado");
      }
    }
  }

  /**
   * Cantidad de clientes conectados.
   */
  getClientCount(): number {
    return this.clients.size;
  }
}

export const wsServer = new WSServer();
