/**
 * Conector a IOL (InvertirOnline) para el panel de opciones.
 *
 * El dominio NO depende de IOL directamente: depende de la interfaz
 * `OptionsDataProvider`. Para cambiar de proveedor (Primary, BYMA, etc.)
 * basta con implementar esta interfaz y swappear la instancia exportada.
 *
 * IOL devuelve el bearer token por OAuth (password grant). Acá lo cacheamos
 * y lo renovamos cuando expira. Configurá IOL_USER / IOL_PASSWORD en .env.
 */

import type { OptionType } from "@arbitraje/shared";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";

/** Una cotización de un contrato de opción, normalizada (agnóstica del proveedor). */
export interface OptionQuote {
  symbol: string;
  underlying: string;
  optionType: OptionType;
  strike: number;
  expiration: string; // YYYY-MM-DD
  bid: number | null;
  ask: number | null;
  last: number | null;
}

export interface OptionsDataProvider {
  /** Trae la cadena de opciones (calls + puts) de un subyacente. */
  getOptionChain(underlying: string): Promise<OptionQuote[]>;
}

const IOL_BASE = "https://api.invertironline.com";

interface IolTokenCache {
  accessToken: string;
  expiresAt: number; // epoch ms
}

class IolOptionsProvider implements OptionsDataProvider {
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

  async getOptionChain(underlying: string): Promise<OptionQuote[]> {
    const token = await this.getToken();
    const url = `${IOL_BASE}/api/v2/bCBA/Titulos/${underlying}/Opciones`;
    logger.info({ underlying }, "[iol-options] GET option chain");

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`IOL Opciones respondió ${res.status}: ${txt}`);
    }
    const raw = (await res.json()) as IolOptionRow[];
    return Array.isArray(raw) ? raw.map((r) => normalize(r, underlying)) : [];
  }
}

/** Forma cruda (parcial) que devuelve IOL para cada contrato de opción. */
interface IolOptionRow {
  simbolo: string;
  descripcion?: string;
  puntas?: { precioCompra?: number; precioVenta?: number }[];
  ultimoPrecio?: number;
  // IOL no siempre trae strike/tipo/vencimiento estructurados → se parsea del símbolo.
}

/**
 * Parsea símbolo IOL de opción. Formato típico: `GFGC50.0AB` →
 * GFG (subyacente), C/V (call/put), 50.0 (strike), AB (vencimiento por letra).
 * Es heurístico; si no matchea, deja strike/expiration en defaults.
 */
function normalize(row: IolOptionRow, underlying: string): OptionQuote {
  const sym = row.simbolo ?? "";
  const m = /^([A-Z]+)([CV])([\d.]+)([A-Z]{2})$/.exec(sym);
  const optionType: OptionType = m?.[2] === "V" ? "put" : "call";
  const strike = m ? Number(m[3]) : NaN;
  const punta = row.puntas?.[0];

  return {
    symbol: sym,
    underlying,
    optionType,
    strike: Number.isNaN(strike) ? 0 : strike,
    expiration: "", // TODO: mapear letra de vencimiento IOL → fecha real
    bid: punta?.precioCompra ?? null,
    ask: punta?.precioVenta ?? null,
    last: row.ultimoPrecio ?? null,
  };
}

/** Instancia activa del proveedor de datos de opciones. Swappeable. */
export const optionsDataProvider: OptionsDataProvider = new IolOptionsProvider();
