import type {
  ApiResponse,
  BondPair,
  PairLiveData,
  PairStatistics,
  PairSnapshot,
  AlertConfig,
  AlertCondition,
  AlertField,
  StatsWindow,
} from "@arbitraje/shared";

const BASE = "http://localhost:3001/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const hasBody = options?.body != null;
  const res = await fetch(`${BASE}${path}`, {
    headers: hasBody ? { "Content-Type": "application/json" } : {},
    ...options,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error ?? `HTTP ${res.status}`);
  }

  return res.json();
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
