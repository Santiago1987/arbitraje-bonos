import type {
  ApiResponse,
  OptionStrategy,
  SimulationRequest,
  SimulationResult,
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
    const msg =
      typeof body?.error === "string" ? body.error : res.statusText;
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function simulateStrategy(
  req: SimulationRequest,
): Promise<SimulationResult> {
  const res = await request<ApiResponse<SimulationResult>>(
    "/options/simulate",
    { method: "POST", body: JSON.stringify(req) },
  );
  return res.data;
}

export async function fetchStrategies(): Promise<OptionStrategy[]> {
  const res = await request<ApiResponse<OptionStrategy[]>>("/options/strategies");
  return res.data;
}

export async function saveStrategy(
  body: Pick<OptionStrategy, "name" | "underlying" | "spot" | "legs">,
): Promise<OptionStrategy> {
  const res = await request<ApiResponse<OptionStrategy>>("/options/strategies", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return res.data;
}

export async function deleteStrategy(id: string): Promise<void> {
  await request(`/options/strategies/${id}`, { method: "DELETE" });
}
