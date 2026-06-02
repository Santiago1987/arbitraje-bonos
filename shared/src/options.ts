// ============================================================
// Tipos compartidos del dominio OPCIONES
// (independiente del dominio Bonos — distinto feed, distinta lógica)
// ============================================================

// --- Instrumentos ---

export type OptionType = "call" | "put";
export type OptionSide = "long" | "short";

/**
 * Una "pata" de una estrategia de opciones (o el subyacente).
 * `kind: "underlying"` representa una posición en el activo subyacente
 * (acción/bono), útil para covered calls, collars, etc.
 */
export type LegKind = "option" | "underlying";

export interface StrategyLeg {
  id: string;
  kind: LegKind;
  side: OptionSide;
  /** Cantidad de contratos (o de unidades de subyacente). Siempre positiva. */
  quantity: number;
  /** Precio de entrada: prima por contrato (opción) o precio del subyacente. */
  entryPrice: number;
  /** Multiplicador del contrato (ej: 100 acciones por contrato). Default 100 para opciones, 1 para subyacente. */
  multiplier: number;

  // --- Solo para kind === "option" ---
  optionType?: OptionType;
  strike?: number;
  /** Fecha de vencimiento ISO (YYYY-MM-DD). Necesaria para griegas/IV. */
  expiration?: string;
  /** Volatilidad implícita anualizada (ej: 0.45 = 45%). Opcional. */
  impliedVol?: number;
  /** Símbolo IOL del contrato, si vino del panel de opciones. */
  symbol?: string;
}

/**
 * Estrategia completa que el usuario arma en el simulador.
 */
export interface OptionStrategy {
  id: string;
  name: string;
  /** Ticker del subyacente (ej: "GGAL"). */
  underlying: string;
  /** Precio spot del subyacente usado como referencia. */
  spot: number;
  legs: StrategyLeg[];
  createdAt?: string;
  updatedAt?: string;
}

// --- Pricing / Griegas ---

export interface Greeks {
  delta: number;
  gamma: number;
  theta: number; // por día
  vega: number; // por 1% (0.01) de vol
  rho: number; // por 1% (0.01) de tasa
}

export interface PricingInput {
  optionType: OptionType;
  spot: number;
  strike: number;
  /** Tiempo a vencimiento en años. */
  timeToExpiry: number;
  /** Tasa libre de riesgo anualizada (ej: 0.4 = 40%). */
  rate: number;
  /** Volatilidad anualizada (ej: 0.45). */
  volatility: number;
  /** Dividend/cost-of-carry yield anualizado. Default 0. */
  dividendYield?: number;
}

export interface PricingResult {
  price: number;
  greeks: Greeks;
  d1: number;
  d2: number;
}

export interface ImpliedVolInput {
  optionType: OptionType;
  marketPrice: number;
  spot: number;
  strike: number;
  timeToExpiry: number;
  rate: number;
  dividendYield?: number;
}

// --- Simulación / Payoff ---

export interface PayoffPoint {
  /** Precio del subyacente en este punto. */
  underlying: number;
  /** P&L al vencimiento (en moneda, ya multiplicado por cantidad y multiplicador). */
  payoff: number;
}

export interface SimulationRequest {
  spot: number;
  legs: StrategyLeg[];
  /** Tasa libre de riesgo para griegas agregadas. */
  rate?: number;
  /** Rango de precios a simular. Si se omite, se calcula alrededor del spot. */
  priceRange?: { min: number; max: number; steps: number };
}

export interface SimulationResult {
  points: PayoffPoint[];
  /** Prima neta: negativo = débito (pagás), positivo = crédito (cobrás). */
  netPremium: number;
  maxProfit: number | null; // null = ilimitado
  maxLoss: number | null; // null = ilimitado
  breakevens: number[];
  /** Griegas agregadas al spot (solo si las patas tienen vol y vencimiento). */
  greeks: Greeks | null;
}
