/**
 * Pricing de opciones europeas con Black-Scholes-Merton.
 * Calcula precio teórico, griegas y volatilidad implícita.
 *
 * Convenciones:
 * - tasas y vol anualizadas (0.4 = 40%)
 * - timeToExpiry en años
 * - theta por día (se divide /365), vega y rho por 1% (se multiplican por 0.01)
 */

import type {
  Greeks,
  ImpliedVolInput,
  OptionType,
  PricingInput,
  PricingResult,
} from "@arbitraje/shared";

const SQRT_2PI = Math.sqrt(2 * Math.PI);

/** Densidad de la normal estándar. */
function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

/** CDF de la normal estándar (aproximación de Abramowitz & Stegun 7.1.26). */
function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = normPdf(x);
  const p =
    d *
    t *
    (0.319381530 +
      t *
        (-0.356563782 +
          t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

interface D1D2 {
  d1: number;
  d2: number;
}

function computeD1D2(input: PricingInput): D1D2 {
  const { spot, strike, timeToExpiry: T, rate: r, volatility: sigma } = input;
  const q = input.dividendYield ?? 0;
  const sqrtT = Math.sqrt(T);
  const d1 =
    (Math.log(spot / strike) + (r - q + 0.5 * sigma * sigma) * T) /
    (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  return { d1, d2 };
}

export function blackScholesPrice(input: PricingInput): number {
  const { optionType, spot, strike, timeToExpiry: T, rate: r } = input;
  const q = input.dividendYield ?? 0;

  // Casos límite: sin tiempo o sin vol → valor intrínseco descontado.
  if (T <= 0 || input.volatility <= 0) {
    const intrinsic =
      optionType === "call"
        ? Math.max(spot - strike, 0)
        : Math.max(strike - spot, 0);
    return intrinsic;
  }

  const { d1, d2 } = computeD1D2(input);
  const discount = Math.exp(-r * T);
  const carry = Math.exp(-q * T);

  if (optionType === "call") {
    return spot * carry * normCdf(d1) - strike * discount * normCdf(d2);
  }
  return strike * discount * normCdf(-d2) - spot * carry * normCdf(-d1);
}

export function computeGreeks(input: PricingInput): Greeks {
  const { optionType, spot, strike, timeToExpiry: T, rate: r } = input;
  const q = input.dividendYield ?? 0;
  const sigma = input.volatility;

  if (T <= 0 || sigma <= 0) {
    // Al vencimiento las griegas degeneran; devolvemos delta binaria y resto 0.
    const itm =
      optionType === "call" ? spot > strike : spot < strike;
    const delta = itm ? (optionType === "call" ? 1 : -1) : 0;
    return { delta, gamma: 0, theta: 0, vega: 0, rho: 0 };
  }

  const { d1, d2 } = computeD1D2(input);
  const sqrtT = Math.sqrt(T);
  const discount = Math.exp(-r * T);
  const carry = Math.exp(-q * T);
  const pdfD1 = normPdf(d1);

  const gamma = (carry * pdfD1) / (spot * sigma * sqrtT);
  const vega = (spot * carry * pdfD1 * sqrtT) * 0.01; // por 1% de vol

  let delta: number;
  let theta: number;
  let rho: number;

  if (optionType === "call") {
    delta = carry * normCdf(d1);
    theta =
      (-(spot * carry * pdfD1 * sigma) / (2 * sqrtT) -
        r * strike * discount * normCdf(d2) +
        q * spot * carry * normCdf(d1)) /
      365;
    rho = strike * T * discount * normCdf(d2) * 0.01;
  } else {
    delta = -carry * normCdf(-d1);
    theta =
      (-(spot * carry * pdfD1 * sigma) / (2 * sqrtT) +
        r * strike * discount * normCdf(-d2) -
        q * spot * carry * normCdf(-d1)) /
      365;
    rho = -strike * T * discount * normCdf(-d2) * 0.01;
  }

  return { delta, gamma, theta, vega, rho };
}

export function price(input: PricingInput): PricingResult {
  const { d1, d2 } = computeD1D2(input);
  return {
    price: blackScholesPrice(input),
    greeks: computeGreeks(input),
    d1,
    d2,
  };
}

/**
 * Volatilidad implícita por Newton-Raphson con fallback a bisección.
 * Devuelve null si no converge (ej: precio de mercado fuera de arbitraje).
 */
export function impliedVolatility(input: ImpliedVolInput): number | null {
  const { optionType, marketPrice, spot, strike, timeToExpiry: T, rate } = input;
  const q = input.dividendYield ?? 0;

  if (T <= 0 || marketPrice <= 0) return null;

  const intrinsic =
    optionType === "call"
      ? Math.max(spot * Math.exp(-q * T) - strike * Math.exp(-rate * T), 0)
      : Math.max(strike * Math.exp(-rate * T) - spot * Math.exp(-q * T), 0);
  if (marketPrice < intrinsic - 1e-6) return null; // viola no-arbitraje

  const makeInput = (sigma: number): PricingInput => ({
    optionType,
    spot,
    strike,
    timeToExpiry: T,
    rate,
    volatility: sigma,
    dividendYield: q,
  });

  // Newton-Raphson
  let sigma = 0.5;
  for (let i = 0; i < 50; i++) {
    const p = blackScholesPrice(makeInput(sigma));
    const vega = computeGreeks(makeInput(sigma)).vega / 0.01; // vega "cruda"
    const diff = p - marketPrice;
    if (Math.abs(diff) < 1e-5) return sigma;
    if (vega < 1e-8) break; // vega muy chica → cambiamos a bisección
    sigma -= diff / vega;
    if (sigma <= 0 || sigma > 10 || Number.isNaN(sigma)) break;
  }

  // Bisección como red de seguridad
  let lo = 1e-4;
  let hi = 10;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const diff = blackScholesPrice(makeInput(mid)) - marketPrice;
    if (Math.abs(diff) < 1e-5) return mid;
    if (diff > 0) hi = mid;
    else lo = mid;
  }
  return null;
}

/** Helper: años entre hoy y una fecha de vencimiento ISO (YYYY-MM-DD). */
export function yearsToExpiry(expiration: string, from: Date = new Date()): number {
  const exp = new Date(`${expiration}T17:00:00-03:00`);
  const ms = exp.getTime() - from.getTime();
  return Math.max(ms / (365 * 24 * 60 * 60 * 1000), 0);
}

export const pricingService = {
  blackScholesPrice,
  computeGreeks,
  price,
  impliedVolatility,
  yearsToExpiry,
};
