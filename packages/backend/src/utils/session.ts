import type { SessionPhase } from "@arbitraje/shared";
import { config } from "../config/index.js";

export interface SessionConfig {
  timezone: string;
  openTime: string; // "HH:MM"
  closeTime: string; // "HH:MM"
  warmupMinutes: number;
  cooldownMinutes: number;
}

export function getSessionConfig(): SessionConfig {
  return {
    timezone: config.SESSION_TIMEZONE,
    openTime: config.SESSION_OPEN_TIME,
    closeTime: config.SESSION_CLOSE_TIME,
    warmupMinutes: config.SESSION_WARMUP_MINUTES,
    cooldownMinutes: config.SESSION_COOLDOWN_MINUTES,
  };
}

function parseHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

interface LocalParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
}

function getLocalParts(ts: Date, timezone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(ts);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)!.value;
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // `Intl` puede devolver "24" a medianoche en algunos runtimes; normalizar.
    hour: get("hour") === "24" ? "00" : get("hour"),
    minute: get("minute"),
  };
}

export function getLocalMinutes(ts: Date, timezone: string): number {
  const { hour, minute } = getLocalParts(ts, timezone);
  return Number(hour) * 60 + Number(minute);
}

/**
 * Devuelve la fecha local en formato "YYYY-MM-DD" usando la timezone dada.
 * Se usa como clave de día en `pair_daily`.
 */
export function getLocalDateKey(ts: Date, timezone: string): string {
  const { year, month, day } = getLocalParts(ts, timezone);
  return `${year}-${month}-${day}`;
}

/**
 * Clasifica un timestamp dentro de la rueda bursátil.
 * La configuración es dinámica para poder re-evaluar histórico si se
 * cambian los horarios.
 */
export function getSessionPhase(
  ts: Date,
  cfg: SessionConfig = getSessionConfig(),
): SessionPhase {
  const local = getLocalMinutes(ts, cfg.timezone);
  const openMin = parseHHMM(cfg.openTime);
  const closeMin = parseHHMM(cfg.closeTime);
  const warmupEnd = openMin + cfg.warmupMinutes;
  const cooldownStart = closeMin - cfg.cooldownMinutes;

  if (local < openMin) return "pre_open";
  if (local >= closeMin) return "post_close";
  if (local < warmupEnd) return "warmup";
  if (local >= cooldownStart) return "cooldown";
  return "regular";
}
