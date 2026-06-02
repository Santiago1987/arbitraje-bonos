import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Plus, Trash2, Play } from "lucide-react";
import type {
  SimulationResult,
  StrategyLeg,
} from "@arbitraje/shared";
import { simulateStrategy } from "./optionsApi";

type DraftLeg = Omit<StrategyLeg, "id"> & { id: string };

function newLeg(partial?: Partial<DraftLeg>): DraftLeg {
  return {
    id: crypto.randomUUID(),
    kind: "option",
    optionType: "call",
    side: "long",
    quantity: 1,
    entryPrice: 0,
    multiplier: 100,
    strike: 0,
    expiration: "",
    impliedVol: undefined,
    ...partial,
  };
}

// Presets útiles para arrancar rápido.
const PRESETS: Record<string, (spot: number) => DraftLeg[]> = {
  "Bull Call Spread": (s) => [
    newLeg({ optionType: "call", side: "long", strike: round(s), entryPrice: s * 0.06 }),
    newLeg({ optionType: "call", side: "short", strike: round(s * 1.1), entryPrice: s * 0.03 }),
  ],
  Straddle: (s) => [
    newLeg({ optionType: "call", side: "long", strike: round(s), entryPrice: s * 0.06 }),
    newLeg({ optionType: "put", side: "long", strike: round(s), entryPrice: s * 0.05 }),
  ],
  "Covered Call": (s) => [
    newLeg({ kind: "underlying", side: "long", strike: undefined, entryPrice: s, multiplier: 100, optionType: undefined }),
    newLeg({ optionType: "call", side: "short", strike: round(s * 1.1), entryPrice: s * 0.03 }),
  ],
};

function round(n: number): number {
  return Math.round(n);
}

function fmt(n: number | null): string {
  if (n === null) return "Ilimitado";
  return n.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

export default function SimulatorView() {
  const [underlying, setUnderlying] = useState("GGAL");
  const [spot, setSpot] = useState(1000);
  const [legs, setLegs] = useState<DraftLeg[]>([
    newLeg({ optionType: "call", side: "long", strike: 1000, entryPrice: 60 }),
  ]);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateLeg = (id: string, patch: Partial<DraftLeg>) =>
    setLegs((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const removeLeg = (id: string) =>
    setLegs((prev) => prev.filter((l) => l.id !== id));

  const applyPreset = (name: string) => {
    setLegs(PRESETS[name](spot));
    setResult(null);
  };

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await simulateStrategy({ spot, legs });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error simulando");
    } finally {
      setLoading(false);
    }
  };

  const chartData = useMemo(
    () =>
      result?.points.map((p) => ({
        x: Math.round(p.underlying),
        pnl: Math.round(p.payoff),
      })) ?? [],
    [result],
  );

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Simulador de operatorias</h1>
        <div className="flex gap-2">
          {Object.keys(PRESETS).map((name) => (
            <button
              key={name}
              onClick={() => applyPreset(name)}
              className="text-xs px-2.5 py-1.5 rounded-md bg-surface-2 hover:bg-surface-3 text-muted hover:text-white transition-colors"
            >
              {name}
            </button>
          ))}
        </div>
      </header>

      {/* Subyacente */}
      <div className="flex gap-4 items-end bg-surface-1 rounded-lg p-3 border border-surface-3/30">
        <Field label="Subyacente">
          <input
            value={underlying}
            onChange={(e) => setUnderlying(e.target.value.toUpperCase())}
            className="input w-28"
          />
        </Field>
        <Field label="Spot">
          <input
            type="number"
            value={spot}
            onChange={(e) => setSpot(Number(e.target.value))}
            className="input w-28"
          />
        </Field>
        <button
          onClick={run}
          disabled={loading}
          className="ml-auto flex items-center gap-2 px-4 py-2 rounded-md bg-accent-blue/20 text-accent-blue hover:bg-accent-blue/30 transition-colors disabled:opacity-50"
        >
          <Play className="w-4 h-4" />
          {loading ? "Simulando..." : "Simular"}
        </button>
      </div>

      {/* Editor de patas */}
      <div className="bg-surface-1 rounded-lg border border-surface-3/30 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-muted text-xs border-b border-surface-3/30">
            <tr>
              {["Tipo", "Lado", "Strike", "Prima/Precio", "Cant.", "Mult.", "Venc.", "IV %", ""].map(
                (h) => (
                  <th key={h} className="text-left font-medium px-3 py-2">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {legs.map((leg) => (
              <tr key={leg.id} className="border-b border-surface-3/20">
                <td className="px-3 py-1.5">
                  <select
                    value={leg.kind === "underlying" ? "underlying" : leg.optionType}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "underlying")
                        updateLeg(leg.id, { kind: "underlying", optionType: undefined, strike: undefined, multiplier: 100 });
                      else
                        updateLeg(leg.id, { kind: "option", optionType: v as "call" | "put" });
                    }}
                    className="input"
                  >
                    <option value="call">Call</option>
                    <option value="put">Put</option>
                    <option value="underlying">Subyacente</option>
                  </select>
                </td>
                <td className="px-3 py-1.5">
                  <select
                    value={leg.side}
                    onChange={(e) => updateLeg(leg.id, { side: e.target.value as "long" | "short" })}
                    className="input"
                  >
                    <option value="long">Compra</option>
                    <option value="short">Venta</option>
                  </select>
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="number"
                    disabled={leg.kind === "underlying"}
                    value={leg.strike ?? ""}
                    onChange={(e) => updateLeg(leg.id, { strike: Number(e.target.value) })}
                    className="input w-24 disabled:opacity-40"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="number"
                    value={leg.entryPrice}
                    onChange={(e) => updateLeg(leg.id, { entryPrice: Number(e.target.value) })}
                    className="input w-24"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="number"
                    value={leg.quantity}
                    onChange={(e) => updateLeg(leg.id, { quantity: Number(e.target.value) })}
                    className="input w-16"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="number"
                    value={leg.multiplier}
                    onChange={(e) => updateLeg(leg.id, { multiplier: Number(e.target.value) })}
                    className="input w-16"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="date"
                    disabled={leg.kind === "underlying"}
                    value={leg.expiration ?? ""}
                    onChange={(e) => updateLeg(leg.id, { expiration: e.target.value })}
                    className="input disabled:opacity-40"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="number"
                    disabled={leg.kind === "underlying"}
                    value={leg.impliedVol != null ? Math.round(leg.impliedVol * 100) : ""}
                    onChange={(e) =>
                      updateLeg(leg.id, {
                        impliedVol: e.target.value ? Number(e.target.value) / 100 : undefined,
                      })
                    }
                    className="input w-16 disabled:opacity-40"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <button
                    onClick={() => removeLeg(leg.id)}
                    className="text-muted hover:text-accent-red"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          onClick={() => setLegs((p) => [...p, newLeg()])}
          className="flex items-center gap-2 px-3 py-2 text-sm text-accent-cyan hover:bg-surface-2 w-full transition-colors"
        >
          <Plus className="w-4 h-4" /> Agregar pata
        </button>
      </div>

      {error && (
        <div className="text-sm text-accent-red bg-accent-red/10 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {/* Resultados */}
      {result && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Métricas */}
          <div className="space-y-3">
            <MetricRow label="Prima neta" value={`${fmt(result.netPremium)} ${result.netPremium < 0 ? "(débito)" : "(crédito)"}`} />
            <MetricRow label="Ganancia máx." value={fmt(result.maxProfit)} positive />
            <MetricRow label="Pérdida máx." value={fmt(result.maxLoss)} negative />
            <MetricRow
              label="Breakevens"
              value={result.breakevens.length ? result.breakevens.map((b) => Math.round(b).toLocaleString("es-AR")).join(" / ") : "—"}
            />
            {result.greeks && (
              <div className="bg-surface-1 rounded-lg p-3 border border-surface-3/30 space-y-1.5">
                <div className="text-xs text-muted mb-1">Griegas (al spot)</div>
                {Object.entries(result.greeks).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-sm">
                    <span className="text-muted capitalize">{k}</span>
                    <span className="font-mono">{(v as number).toFixed(4)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Gráfico de payoff */}
          <div className="lg:col-span-2 bg-surface-1 rounded-lg p-3 border border-surface-3/30 h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff15" />
                <XAxis dataKey="x" tick={{ fontSize: 11, fill: "#9ca3af" }} />
                <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} width={60} />
                <Tooltip
                  contentStyle={{ background: "#1a1d24", border: "1px solid #ffffff20", borderRadius: 8 }}
                  formatter={(v) => [Number(v).toLocaleString("es-AR"), "P&L"]}
                  labelFormatter={(l) => `Subyacente: ${l}`}
                />
                <ReferenceLine y={0} stroke="#ffffff40" />
                <ReferenceLine x={Math.round(spot)} stroke="#22d3ee" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="pnl" stroke="#3b82f6" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}

function MetricRow({
  label,
  value,
  positive,
  negative,
}: {
  label: string;
  value: string;
  positive?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="bg-surface-1 rounded-lg p-3 border border-surface-3/30 flex justify-between items-center">
      <span className="text-sm text-muted">{label}</span>
      <span
        className={`font-mono text-sm ${
          positive ? "text-accent-green" : negative ? "text-accent-red" : "text-white"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
