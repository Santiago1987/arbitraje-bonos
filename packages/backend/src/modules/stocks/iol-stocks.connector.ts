/**
 * Conector a IOL (InvertirOnline) para cotizaciones de acciones argentinas.
 *
 * Self-contained a propósito: el módulo `stocks` no depende de `options`
 * (cada dominio vive aislado, según la arquitectura del proyecto). Comparte
 * el .env (IOL_USER / IOL_PASSWORD) y el mismo OAuth password grant, pero
 * mantiene su propio cache de token.
 */

import type { ArgStock } from "@arbitraje/shared";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";

const IOL_BASE = "https://api.invertironline.com";
const ENDPOINT = "/api/v2/Cotizaciones/acciones/argentina/Todos";

interface IolTokenCache {
  accessToken: string;
  expiresAt: number; // epoch ms
}

/** Forma cruda (parcial) de cada título en la respuesta de IOL. */
interface IolStockRow {
  simbolo: string;
  ultimoPrecio: number;
  variacionPorcentual: number;
  apertura: number;
  maximo: number;
  minimo: number;
  volumen: number;
  cantidadOperaciones: number;
  fecha: string; // ART (UTC-3) sin offset, ej: "2026-06-05T16:59:09.837"
  descripcion: string;
  plazo: string;
}

class IolStocksConnector {
  private tokenCache: IolTokenCache | null = null;

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 30_000) {
      return this.tokenCache.accessToken;
    }
    if (!config.IOL_USER || !config.IOL_PASSWORD) {
      throw new Error(
        "Falta IOL_USER / IOL_PASSWORD en el .env para autenticar contra IOL.",
      );
    }

    const body = new URLSearchParams({
      username: config.IOL_USER,
      password: config.IOL_PASSWORD,
      grant_type: "password",
    });

    const res = await fetch(`${IOL_BASE}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`IOL /token respondió ${res.status}: ${txt}`);
    }
    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.tokenCache = {
      accessToken: data.access_token,
      expiresAt: now + data.expires_in * 1000,
    };
    return data.access_token;
  }

  /** Trae todas las acciones argentinas y las normaliza al dominio. */
  async getAllStocks(): Promise<ArgStock[]> {
    const token = await this.getToken();
    logger.info("[iol-stocks] GET acciones/argentina/Todos");

    const res = await fetch(`${IOL_BASE}${ENDPOINT}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`IOL Cotizaciones respondió ${res.status}: ${txt}`);
    }
    const json = (await res.json()) as { titulos?: IolStockRow[] };
    const rows = Array.isArray(json.titulos) ? json.titulos : [];
    return rows.map(normalize);
  }
}

/**
 * IOL manda `fecha` en hora de Argentina (UTC-3) sin offset. Argentina no
 * tiene DST, así que la fijamos a -03:00 para obtener el instante UTC correcto.
 */
function parseArtDate(fecha: string): Date {
  const d = new Date(`${fecha}-03:00`);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function normalize(row: IolStockRow): ArgStock {
  return {
    simbolo: row.simbolo,
    ultimoPrecio: row.ultimoPrecio ?? 0,
    variacionPorcentual: row.variacionPorcentual ?? 0,
    apertura: row.apertura ?? 0,
    maximo: row.maximo ?? 0,
    minimo: row.minimo ?? 0,
    volumen: row.volumen ?? 0,
    cantidadOperaciones: row.cantidadOperaciones ?? 0,
    fecha: parseArtDate(row.fecha),
    descripcion: row.descripcion ?? "",
    plazo: row.plazo ?? "",
  };
}

export const iolStocksConnector = new IolStocksConnector();
