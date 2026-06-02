/**
 * Simulación de estrategias de opciones: curva de P&L al vencimiento,
 * primas netas, máximos/mínimos, breakevens y griegas agregadas al spot.
 */

import type {
  Greeks,
  PayoffPoint,
  SimulationRequest,
  SimulationResult,
  StrategyLeg,
} from "@arbitraje/shared";
import { computeGreeks, yearsToExpiry } from "./pricing.service.js";

const DEFAULT_RATE = 0.4; // tasa libre de riesgo por defecto (ARS), configurable por request

/** P&L de una sola pata al vencimiento, para un precio del subyacente S. */
function legPayoffAtExpiry(leg: StrategyLeg, S: number): number {
  const signedQty =
    (leg.side === "long" ? 1 : -1) * leg.quantity * leg.multiplier;

  if (leg.kind === "underlying") {
    // P&L lineal sobre el subyacente.
    return (S - leg.entryPrice) * signedQty;
  }

  // Opción: valor intrínseco al vencimiento menos la prima pagada/cobrada.
  const strike = leg.strike ?? 0;
  const intrinsic =
    leg.optionType === "call"
      ? Math.max(S - strike, 0)
      : Math.max(strike - S, 0);

  // long: pagás prima (-entryPrice), recibís intrínseco (+).
  // short: cobrás prima (+entryPrice), pagás intrínseco (-).
  const perUnit =
    leg.side === "long" ? intrinsic - leg.entryPrice : leg.entryPrice - intrinsic;
  return perUnit * leg.quantity * leg.multiplier;
}

/** Prima neta de la estrategia (negativo = débito, positivo = crédito). */
function netPremium(legs: StrategyLeg[]): number {
  let net = 0;
  for (const leg of legs) {
    if (leg.kind !== "option") continue;
    const cashflow =
      (leg.side === "long" ? -1 : 1) *
      leg.entryPrice *
      leg.quantity *
      leg.multiplier;
    net += cashflow;
  }
  return net;
}

/** Rango por defecto: ±40% alrededor del spot (acotado por los strikes). */
function defaultRange(spot: number, legs: StrategyLeg[]) {
  const strikes = legs
    .filter((l) => l.kind === "option" && typeof l.strike === "number")
    .map((l) => l.strike as number);
  const lo = Math.min(spot * 0.6, ...strikes);
  const hi = Math.max(spot * 1.4, ...strikes);
  return { min: Math.max(lo * 0.9, 0), max: hi * 1.1, steps: 120 };
}

/** Detecta breakevens por cambio de signo entre puntos consecutivos (interpolación lineal). */
function findBreakevens(points: PayoffPoint[]): number[] {
  const result: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a.payoff === 0) result.push(a.underlying);
    else if (a.payoff < 0 !== b.payoff < 0) {
      const t = Math.abs(a.payoff) / (Math.abs(a.payoff) + Math.abs(b.payoff));
      result.push(a.underlying + t * (b.underlying - a.underlying));
    }
  }
  return result;
}

/**
 * Griegas agregadas al spot. Solo suma las patas-opción que tengan
 * vencimiento y vol implícita; si ninguna las tiene, devuelve null.
 */
function aggregateGreeks(
  spot: number,
  legs: StrategyLeg[],
  rate: number,
): Greeks | null {
  let any = false;
  const total: Greeks = { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };

  for (const leg of legs) {
    const sign = (leg.side === "long" ? 1 : -1) * leg.quantity * leg.multiplier;

    if (leg.kind === "underlying") {
      total.delta += sign; // delta del subyacente = 1 por unidad
      any = true;
      continue;
    }
    if (
      leg.optionType == null ||
      leg.strike == null ||
      leg.expiration == null ||
      leg.impliedVol == null
    ) {
      continue;
    }
    const T = yearsToExpiry(leg.expiration);
    const g = computeGreeks({
      optionType: leg.optionType,
      spot,
      strike: leg.strike,
      timeToExpiry: T,
      rate,
      volatility: leg.impliedVol,
    });
    total.delta += g.delta * sign;
    total.gamma += g.gamma * sign;
    total.theta += g.theta * sign;
    total.vega += g.vega * sign;
    total.rho += g.rho * sign;
    any = true;
  }

  return any ? total : null;
}

export function simulate(req: SimulationRequest): SimulationResult {
  const { spot, legs } = req;
  const rate = req.rate ?? DEFAULT_RATE;
  const range = req.priceRange ?? defaultRange(spot, legs);

  const points: PayoffPoint[] = [];
  const step = (range.max - range.min) / Math.max(range.steps, 1);
  for (let i = 0; i <= range.steps; i++) {
    const S = range.min + i * step;
    let payoff = 0;
    for (const leg of legs) payoff += legPayoffAtExpiry(leg, S);
    points.push({ underlying: S, payoff });
  }

  const payoffs = points.map((p) => p.payoff);
  const rawMax = Math.max(...payoffs);
  const rawMin = Math.min(...payoffs);

  // Heurística de "ilimitado": si el extremo del rango sigue siendo el máximo/mínimo
  // y la pendiente no se aplana, lo marcamos como null (ilimitado).
  const n = points.length;
  const slopeHi = payoffs[n - 1] - payoffs[n - 2];
  const slopeLo = payoffs[0] - payoffs[1];
  const maxProfit =
    (slopeHi > 1e-6 && rawMax === payoffs[n - 1]) ||
    (slopeLo > 1e-6 && rawMax === payoffs[0])
      ? null
      : rawMax;
  const maxLoss =
    (slopeHi < -1e-6 && rawMin === payoffs[n - 1]) ||
    (slopeLo < -1e-6 && rawMin === payoffs[0])
      ? null
      : rawMin;

  return {
    points,
    netPremium: netPremium(legs),
    maxProfit,
    maxLoss,
    breakevens: findBreakevens(points),
    greeks: aggregateGreeks(spot, legs, rate),
  };
}

export const payoffService = { simulate };
