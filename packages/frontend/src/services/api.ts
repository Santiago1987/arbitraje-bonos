import type {
  ApiResponse,
  Bond,
  BondPair,
  PairLiveData,
  PairStatistics,
  PairSummary,
  PairSnapshot,
  PairDailyBands,
  AlertConfig,
  AlertCondition,
  AlertField,
  StatsWindow,
  OHLCV,
  TimeframeKey,
  ArbitrageOperation,
  Exercise,
  ExerciseDetail,
  OperationSide,
} from "@arbitraje/shared";

const BASE = "http://localhost:3001/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const hasBody = options?.body != null;
  const res = await fetch(`${BASE}${path}`, {
    headers: hasBody ? { "Content-Type": "application/json" } : {},
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const raw = body?.error;
    let message: string;
    if (typeof raw === "string") {
      message = raw;
    } else if (raw && typeof raw === "object") {
      // Zod's .format() devuelve un árbol anidado. Aplanamos a "campo: motivo".
      const issues: string[] = [];
      const walk = (node: unknown, path: string) => {
        if (!node || typeof node !== "object") return;
        for (const [key, value] of Object.entries(node)) {
          if (key === "_errors" && Array.isArray(value) && value.length > 0) {
            issues.push(`${path || "(root)"}: ${value.join(", ")}`);
          } else {
            walk(value, path ? `${path}.${key}` : key);
          }
        }
      };
      walk(raw, "");
      message = issues.length
        ? issues.join(" | ")
        : JSON.stringify(raw);
    } else {
      message = res.statusText || `HTTP ${res.status}`;
    }
    console.error(`[api] ${res.status} ${path}`, body);
    throw new Error(message);
  }

  return res.json();
}

// ---- Bonds ----

export async function fetchBonds(): Promise<Bond[]> {
  const res = await request<ApiResponse<Bond[]>>("/bonds");
  return res.data;
}

// ---- Pairs ----

interface PairWithLive extends BondPair {
  live: PairLiveData | null;
}

export async function fetchPairs(): Promise<PairWithLive[]> {
  const res = await request<ApiResponse<PairWithLive[]>>("/pairs");
  return res.data;
}

export async function fetchPair(id: string): Promise<PairWithLive> {
  const res = await request<ApiResponse<PairWithLive>>(`/pairs/${id}`);
  return res.data;
}

export async function createPair(pair: {
  name: string;
  bondA: string;
  bondB: string;
  settlementA: string;
  settlementB: string;
  type: string;
}): Promise<PairWithLive> {
  const res = await request<ApiResponse<PairWithLive>>("/pairs", {
    method: "POST",
    body: JSON.stringify(pair),
  });
  return res.data;
}

export async function deletePair(id: string): Promise<void> {
  await request(`/pairs/${id}`, { method: "DELETE" });
}

// ---- Summary ----

export async function fetchPairsSummary(): Promise<PairSummary[]> {
  const res = await request<ApiResponse<PairSummary[]>>("/pairs/summary");
  return res.data;
}

// ---- Statistics ----

export async function fetchPairStats(
  pairId: string,
  window: StatsWindow = "1m",
): Promise<PairStatistics> {
  const res = await request<ApiResponse<PairStatistics>>(
    `/pairs/${pairId}/stats?window=${window}`,
  );
  return res.data;
}

export async function fetchAllStats(
  window: StatsWindow = "1m",
): Promise<PairStatistics[]> {
  const res = await request<ApiResponse<PairStatistics[]>>(
    `/stats?window=${window}`,
  );
  return res.data;
}

// ---- History ----

export async function fetchPairHistory(
  pairId: string,
  from?: string,
  to?: string,
  limit = 1000,
): Promise<PairSnapshot[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (from) params.set("from", from);
  if (to) params.set("to", to);

  const res = await request<ApiResponse<PairSnapshot[]>>(
    `/pairs/${pairId}/history?${params}`,
  );
  return res.data;
}

// ---- Candles ----

// El backend serializa Date como ISO string en JSON.
export type CandleAPI = Omit<OHLCV, "openTime" | "closeTime"> & {
  openTime: string;
  closeTime: string;
};

export async function fetchPairCandles(
  pairId: string,
  opts: {
    timeframe?: TimeframeKey;
    from?: string;
    to?: string;
    limit?: number;
  } = {},
): Promise<CandleAPI[]> {
  const params = new URLSearchParams();
  if (opts.timeframe) params.set("timeframe", opts.timeframe);
  if (opts.from) params.set("from", opts.from);
  if (opts.to) params.set("to", opts.to);
  if (opts.limit) params.set("limit", String(opts.limit));

  const res = await request<ApiResponse<CandleAPI[]>>(
    `/pairs/${pairId}/candles?${params}`,
  );
  return res.data;
}

// ---- Bond / Ratio daily candles (vista de gráficos por activo) ----

export async function fetchBondCandles(opts: {
  ticker: string;
  settlement: string;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<CandleAPI[]> {
  const params = new URLSearchParams({
    ticker: opts.ticker,
    settlement: opts.settlement,
  });
  if (opts.from) params.set("from", opts.from);
  if (opts.to) params.set("to", opts.to);
  if (opts.limit) params.set("limit", String(opts.limit));

  const res = await request<ApiResponse<CandleAPI[]>>(
    `/bonds/candles?${params}`,
  );
  return res.data;
}

export async function fetchRatioCandles(opts: {
  tickerA: string;
  settlementA: string;
  tickerB: string;
  settlementB: string;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<CandleAPI[]> {
  const params = new URLSearchParams({
    tickerA: opts.tickerA,
    settlementA: opts.settlementA,
    tickerB: opts.tickerB,
    settlementB: opts.settlementB,
  });
  if (opts.from) params.set("from", opts.from);
  if (opts.to) params.set("to", opts.to);
  if (opts.limit) params.set("limit", String(opts.limit));

  const res = await request<ApiResponse<CandleAPI[]>>(
    `/ratio/candles?${params}`,
  );
  return res.data;
}

// ---- Daily bands (rolling avg de high/low de las últimas N ruedas) ----

export async function fetchPairDailyBands(
  pairId: string,
  opts: { window?: number; days?: number } = {},
): Promise<PairDailyBands> {
  const params = new URLSearchParams();
  if (opts.window !== undefined) params.set("window", String(opts.window));
  if (opts.days !== undefined) params.set("days", String(opts.days));

  const res = await request<ApiResponse<PairDailyBands>>(
    `/pairs/${pairId}/daily/bands?${params}`,
  );
  return res.data;
}

// ---- Alerts ----

export async function fetchAlerts(): Promise<AlertConfig[]> {
  const res = await request<ApiResponse<AlertConfig[]>>("/alerts");
  return res.data;
}

export async function createAlert(alert: {
  pairId: string;
  field: AlertField;
  condition: AlertCondition;
  threshold: number;
  message?: string;
}): Promise<AlertConfig> {
  const res = await request<ApiResponse<AlertConfig>>("/alerts", {
    method: "POST",
    body: JSON.stringify(alert),
  });
  return res.data;
}

export async function deleteAlert(id: string): Promise<void> {
  await request(`/alerts/${id}`, { method: "DELETE" });
}

export async function reactivateAlert(id: string): Promise<void> {
  await request(`/alerts/${id}/reactivate`, { method: "PATCH" });
}

// ---- Live ----

export async function fetchLiveData(): Promise<PairLiveData[]> {
  const res = await request<ApiResponse<PairLiveData[]>>("/live");
  return res.data;
}

// ---- BYMA connection ----

export async function connectByma(credentials: {
  sessionId: string;
  connId: string;
  wsSecKey: string;
}): Promise<Record<string, unknown>> {
  const res = await request<ApiResponse<Record<string, unknown>>>(
    "/byma/connect",
    {
      method: "POST",
      body: JSON.stringify(credentials),
    },
  );
  return res.data;
}

export async function disconnectByma(): Promise<Record<string, unknown>> {
  const res = await request<ApiResponse<Record<string, unknown>>>(
    "/byma/disconnect",
    {
      method: "POST",
    },
  );
  return res.data;
}

// ---- Health ----

export async function fetchHealth(): Promise<Record<string, unknown>> {
  return request("/health");
}

// ---- Ejercicios y operaciones de arbitraje ----

export async function fetchExercisesForPair(
  pairId: string,
): Promise<Exercise[]> {
  const res = await request<ApiResponse<Exercise[]>>(
    `/pairs/${pairId}/exercises`,
  );
  return res.data;
}

export async function openExercise(
  pairId: string,
  payload: { name: string; openingNotes?: string },
): Promise<Exercise> {
  const res = await request<ApiResponse<Exercise>>(
    `/pairs/${pairId}/exercises`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
  return res.data;
}

export async function fetchExerciseDetail(
  exerciseId: string,
): Promise<ExerciseDetail> {
  const res = await request<ApiResponse<ExerciseDetail>>(
    `/exercises/${exerciseId}`,
  );
  return res.data;
}

export async function closeExercise(
  exerciseId: string,
  closingNotes?: string,
): Promise<Exercise> {
  const res = await request<ApiResponse<Exercise>>(
    `/exercises/${exerciseId}/close`,
    {
      method: "PATCH",
      body: JSON.stringify({ closingNotes: closingNotes ?? "" }),
    },
  );
  return res.data;
}

export async function createOperation(
  exerciseId: string,
  payload: {
    side: OperationSide;
    nominalsA: number;
    nominalsB: number;
    priceA: number;
    priceB: number;
    timestamp?: string;
    notes?: string;
  },
): Promise<ArbitrageOperation> {
  const res = await request<ApiResponse<ArbitrageOperation>>(
    `/exercises/${exerciseId}/operations`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
  return res.data;
}

export async function updateOperation(
  operationId: string,
  payload: {
    side?: OperationSide;
    nominalsA?: number;
    nominalsB?: number;
    priceA?: number;
    priceB?: number;
    timestamp?: string;
    notes?: string;
  },
): Promise<ArbitrageOperation> {
  const res = await request<ApiResponse<ArbitrageOperation>>(
    `/operations/${operationId}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
  return res.data;
}

export async function deleteOperation(operationId: string): Promise<void> {
  await request(`/operations/${operationId}`, { method: "DELETE" });
}
