import WebSocket from "ws";
import type { RawTickData } from "@arbitraje/shared";
import { config } from "../../../config/index.js";
import { marketDataService } from "./market-data.service.js";
import { eventBus } from "./event-bus.js";
import { logger } from "../../../utils/logger.js";

/**
 * BymaConnector
 *
 * Gestiona la conexión WebSocket con BYMA.
 * Parsea los mensajes FIX y los entrega al MarketDataService.
 * Implementa reconexión automática con backoff exponencial.
 *
 * IMPORTANTE: Vas a tener que adaptar el parseo del mensaje
 * al formato exacto que te manda tu servidor FIX/BYMA.
 */
class BymaConnector {
  private ws: WebSocket | null = null;
  private retryCount = 0;
  private isIntentionallyClosed = false;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private sessionId = "";
  private connId = "";
  private wsSecKey = "";
  private bymaConfirmed = false;
  private extraTopics: string[] = [];

  /**
   * Topics adicionales (ej. acciones CI/24hs) que se suman a la suscripción.
   * Si ya estamos suscriptos, manda la suscripción incremental al instante.
   */
  setExtraTopics(topics: string[]): void {
    this.extraTopics = topics;
    if (
      this.bymaConfirmed &&
      this.ws?.readyState === WebSocket.OPEN &&
      topics.length > 0
    ) {
      this.ws.send(
        JSON.stringify({ _req: "S", topicType: "md", topics, replace: false }),
      );
    }
  }

  /**
   * Configura las credenciales necesarias para conectar con BYMA.
   * Se deben setear antes de llamar a connect().
   */
  setCredentials(sessionId: string, connId: string, wsSecKey: string): void {
    this.sessionId = sessionId;
    this.connId = connId;
    this.wsSecKey = wsSecKey;
  }

  /**
   * Inicia la conexión con BYMA.
   * Requiere que se hayan seteado las credenciales con setCredentials().
   */
  connect(): void {
    if (!this.sessionId || !this.connId || !this.wsSecKey) {
      logger.warn("BymaConnector: no se puede conectar sin credenciales");
      return;
    }
    this.isIntentionallyClosed = false;
    this.createConnection();
  }

  /**
   * Cierra la conexión limpiamente.
   */
  disconnect(): void {
    this.isIntentionallyClosed = true;
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setBymaConfirmed(false);
    logger.info("BymaConnector desconectado");
  }

  private setBymaConfirmed(value: boolean): void {
    if (this.bymaConfirmed === value) return;
    this.bymaConfirmed = value;
    eventBus.emit("byma:status", { connected: value });
  }

  private createConnection(): void {
    try {
      logger.info(`Conectando a BYMA: ${config.BYMA_WS_URL}`);
      this.ws = new WebSocket(
        `${config.BYMA_WS_URL}/ws?session_id=${this.sessionId}&conn_id=${this.connId}`,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            Origin: "https://matriz.bull.xoms.com.ar",
            "accept-language": "es-ES,es;q=0.6",
            "accept-encoding": "gzip, deflate, br, zstd",
            "cache-control": "no-cache",
            connection: "upgrade",
            host: "matriz.bull.xoms.com.ar",
            pragma: "no-cache",
            "sec-websocket-extensions":
              "permessage-deflate; client_max_window_bits",
            "sec-websocket-key": `${this.wsSecKey}`,
            "sec-websocket-version": "13",
            upgrade: "websocket",
          },
        },
      );

      this.ws.on("open", () => {
        logger.info("Conexión con BYMA establecida");
        this.retryCount = 0;
        //this.startHeartbeat(); NO SE USA POR EL MOMENTO
      });

      this.ws.on("message", (raw: WebSocket.Data) => {
        try {
          this.handleMessage(raw);
        } catch (error) {
          logger.error({ error }, "Error procesando mensaje de BYMA");
        }
      });

      this.ws.on("close", (code, reason) => {
        logger.warn(
          { code, reason: reason.toString() },
          "Conexión con BYMA cerrada",
        );
        this.stopHeartbeat();
        this.setBymaConfirmed(false);
        if (!this.isIntentionallyClosed) {
          //this.reconnect();
        }
      });

      this.ws.on("error", (error) => {
        logger.error({ error }, "Error en conexión con BYMA");
        // El evento 'close' se disparará después, que maneja la reconexión
      });
    } catch (error) {
      logger.error({ error }, "Error al crear conexión con BYMA");
      //this.reconnect();
    }
  }

  /**
   * Parsea el mensaje recibido de BYMA.
   */
  private handleMessage(raw: WebSocket.Data): void {
    const text = raw.toString();
    let ticker: string | null = null;
    let data: RawTickData | null = null;

    if (text.includes('"status":"online"') && this.ws) {
      this.setBymaConfirmed(true);
      logger.info(
        "Suscripción a BYMA confirmada, enviando solicitud de datos...",
      );
      const sub = {
        _req: "S",
        topicType: "md",
        // ponytail: la lista de bonos sigue hardcodeada; migrarla a BD es otro ticket.
        topics: [
          ...this.extraTopics,
          "md.bm_MERV_AL41_24hs",
          "md.bm_MERV_AL41D_24hs",
          "md.bm_MERV_AL41C_24hs",
          "md.bm_MERV_GD41_24hs",
          "md.bm_MERV_GD41D_24hs",
          "md.bm_MERV_GD41C_24hs",
          "md.bm_MERV_AL35_24hs",
          "md.bm_MERV_AL35D_24hs",
          "md.bm_MERV_AL35C_24hs",
          "md.bm_MERV_GD35_24hs",
          "md.bm_MERV_GD35D_24hs",
          "md.bm_MERV_GD35C_24hs",
          "md.bm_MERV_GD30_24hs",
          "md.bm_MERV_GD30D_24hs",
          "md.bm_MERV_GD30C_24hs",
          "md.bm_MERV_AL30_24hs",
          "md.bm_MERV_AL30D_24hs",
          "md.bm_MERV_AL30C_24hs",
          "md.bm_MERV_GD29_24hs",
          "md.bm_MERV_GD29D_24hs",
          "md.bm_MERV_GD29C_24hs",
          "md.bm_MERV_AL29_24hs",
          "md.bm_MERV_AL29D_24hs",
          "md.bm_MERV_AL29C_24hs",
          "md.bm_MERV_AE38_24hs",
          "md.bm_MERV_AE38D_24hs",
          "md.bm_MERV_AE38C_24hs",
          "md.bm_MERV_GD38_24hs",
          "md.bm_MERV_GD38D_24hs",
          "md.bm_MERV_GD38C_24hs",
          "md.bm_MERV_GD41_CI",
          "md.bm_MERV_AL41C_CI",
          "md.bm_MERV_GD30_CI",
          "md.bm_MERV_GD30D_CI",
          "md.bm_MERV_GD30C_CI",
          "md.bm_MERV_AL30_CI",
          "md.bm_MERV_AL30D_CI",
          "md.bm_MERV_AL30C_CI",
          "md.bm_MERV_PESOS_1D",
          "md.bm_MERV_PESOS_2D",
          "md.bm_MERV_PESOS_3D",
          "md.bm_MERV_PESOS_4D",
        ],
        replace: false,
      };
      this.ws.send(`${JSON.stringify(sub)}`);
      return;
    }

    if (text.startsWith("M:")) {
      const parts = text.split("|");
      ticker = parts[0].split("_")[2] + "_" + parts[0].split("_")[3];
      data = {
        num_oper: parts[1],
        prc_comp: parts[2],
        cant_comp: parts[3],
        prc_venta: parts[4],
        cant_venta: parts[5],
        prc_act: parts[6],
        time_ult_oper: new Date(new Date(parts[7]).getTime() - 180 * 60000),
        vol_inter: parts[9],
        vol_nom: parts[10],
        prc_min: parts[11],
        prc_max: parts[12],
        fecha_ant: parts[16],
        prc_ant: parts[19],
      };
    }

    if (!ticker || !data) {
      logger.warn("Mensaje sin ticker recibido, ignorando");
      console.log("Mensaje recibido sin ticker o datos parseados:", text);
      return;
    }

    // Entregamos al MarketDataService
    marketDataService.processTick(ticker, data);
  }

  /**
   * Reconexión con backoff exponencial.
   * 1s, 2s, 4s, 8s, 16s, 32s... hasta el máximo configurado.
   */
  private reconnect(): void {
    if (this.retryCount >= config.BYMA_RECONNECT_MAX_RETRIES) {
      logger.error(
        `Máximo de reintentos alcanzado (${config.BYMA_RECONNECT_MAX_RETRIES}). Deteniendo reconexión.`,
      );
      return;
    }

    const delay = Math.min(
      config.BYMA_RECONNECT_BASE_DELAY_MS * Math.pow(2, this.retryCount),
      30_000, // Máximo 30 segundos entre reintentos
    );

    this.retryCount++;
    logger.info(
      `Reintentando conexión en ${delay}ms (intento ${this.retryCount})`,
    );

    setTimeout(() => this.createConnection(), delay);
  }

  /**
   * Heartbeat para detectar conexiones muertas.
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Estado de la conexión.
   */
  getStatus() {
    return {
      connected: this.bymaConfirmed,
      retryCount: this.retryCount,
      url: config.BYMA_WS_URL,
    };
  }
}

export const bymaConnector = new BymaConnector();
