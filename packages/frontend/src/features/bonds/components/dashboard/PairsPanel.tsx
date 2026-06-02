import { useEffect, useMemo, useState } from "react";
import { X, Trash2, Plus } from "lucide-react";
import clsx from "clsx";
import type { Bond, PairType } from "@arbitraje/shared";
import { useMarketStore } from "../../store/marketStore";
import { createPair, deletePair, fetchBonds } from "../../services/api";
import { subscribeToPairs, unsubscribeFromPairs } from "../../services/wsClient";

interface Props {
  open: boolean;
  onClose: () => void;
}

const TYPE_LABELS: Record<PairType, string> = {
  ratio: "Ratio (A / B)",
  spread: "Spread (A − B)",
};

const bondLabel = (b: Bond) =>
  `${b.ticker} — ${b.name} (${b.settlement})`;

const PairsPanel = ({ open, onClose }: Props) => {
  const bonds = useMarketStore((s) => s.bonds);
  const pairs = useMarketStore((s) => s.pairs);
  const setBonds = useMarketStore((s) => s.setBonds);
  const addPair = useMarketStore((s) => s.addPair);
  const removePair = useMarketStore((s) => s.removePair);

  const [tickerA, setTickerA] = useState<string>("");
  const [tickerB, setTickerB] = useState<string>("");
  const [type, setType] = useState<PairType>("ratio");
  const [name, setName] = useState<string>("");
  const [nameTouched, setNameTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refrescar catálogo de bonos al abrir (por si se agregaron en otro lado)
  useEffect(() => {
    if (!open) return;
    fetchBonds()
      .then(setBonds)
      .catch(() => {});
  }, [open, setBonds]);

  // Auto-componer el nombre como "tickerA-tickerB" mientras no lo edite el usuario
  useEffect(() => {
    if (nameTouched) return;
    if (tickerA && tickerB) setName(`${tickerA}-${tickerB}`);
    else setName("");
  }, [tickerA, tickerB, nameTouched]);

  const bondMap = useMemo(() => {
    const m = new Map<string, Bond>();
    for (const b of bonds) m.set(b.ticker, b);
    return m;
  }, [bonds]);

  const canSubmit = useMemo(
    () =>
      tickerA !== "" &&
      tickerB !== "" &&
      tickerA !== tickerB &&
      name.trim() !== "",
    [tickerA, tickerB, name],
  );

  const resetForm = () => {
    setTickerA("");
    setTickerB("");
    setType("ratio");
    setName("");
    setNameTouched(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    const bondA = bondMap.get(tickerA);
    const bondB = bondMap.get(tickerB);
    if (!bondA || !bondB) {
      setError("Bono inválido");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const created = await createPair({
        name: name.trim(),
        bondA: bondA.ticker,
        bondB: bondB.ticker,
        settlementA: bondA.settlement,
        settlementB: bondB.settlement,
        type,
      });
      const { live: _live, ...rest } = created;
      addPair(rest);
      subscribeToPairs([created.id]);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear par");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string, label: string) => {
    if (!window.confirm(`¿Eliminar el par ${label}?`)) return;
    try {
      await deletePair(id);
      unsubscribeFromPairs([id]);
      removePair(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al borrar par");
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={clsx(
          "absolute inset-0 z-30 bg-black/40 transition-opacity",
          open ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
      />

      {/* Drawer */}
      <aside
        className={clsx(
          "absolute top-0 right-0 z-40 h-full w-96 max-w-full bg-surface-1 border-l border-surface-3/40 shadow-2xl flex flex-col transition-transform duration-200",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-surface-3/40">
          <h2 className="text-base font-semibold">Pares</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-surface-2 transition-colors"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {/* Form */}
          <form
            onSubmit={handleSubmit}
            className="px-4 py-3 space-y-3 border-b border-surface-3/30"
          >
            <div>
              <label className="block text-xs text-muted mb-1">Bono A</label>
              <select
                value={tickerA}
                onChange={(e) => setTickerA(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-surface-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue"
              >
                <option value="">Seleccionar bono…</option>
                {bonds.map((b) => (
                  <option
                    key={b.ticker}
                    value={b.ticker}
                    disabled={b.ticker === tickerB}
                  >
                    {bondLabel(b)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-muted mb-1">Bono B</label>
              <select
                value={tickerB}
                onChange={(e) => setTickerB(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-surface-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue"
              >
                <option value="">Seleccionar bono…</option>
                {bonds.map((b) => (
                  <option
                    key={b.ticker}
                    value={b.ticker}
                    disabled={b.ticker === tickerA}
                  >
                    {bondLabel(b)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-muted mb-1">Tipo</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as PairType)}
                className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-surface-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue"
              >
                {(Object.keys(TYPE_LABELS) as PairType[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-muted mb-1">Nombre</label>
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameTouched(true);
                }}
                placeholder="Ej: GD30-AL30"
                className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-surface-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue"
              />
            </div>

            {tickerA === tickerB && tickerA !== "" && (
              <div className="text-xs text-accent-amber bg-accent-amber/10 border border-accent-amber/20 rounded-lg px-3 py-2">
                Los dos bonos deben ser distintos.
              </div>
            )}

            {error && (
              <div className="text-xs text-accent-red bg-accent-red/10 border border-accent-red/20 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={!canSubmit || submitting}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-accent-blue hover:bg-accent-blue/80 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              {submitting ? "Creando…" : "Crear par"}
            </button>
          </form>

          {/* Lista de pares activos */}
          <div className="px-4 py-3">
            <h3 className="text-xs uppercase tracking-wider text-muted mb-2">
              Pares activos ({pairs.length})
            </h3>
            {pairs.length === 0 ? (
              <p className="text-xs text-muted py-2">Sin pares configurados.</p>
            ) : (
              <ul className="space-y-2">
                {pairs.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 bg-surface-2/60 rounded-lg px-3 py-2 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-mono font-semibold truncate">
                        {p.name}
                      </div>
                      <div className="text-muted truncate">
                        {p.bondA} ({p.settlementA}) {p.type === "ratio" ? "/" : "−"}{" "}
                        {p.bondB} ({p.settlementB})
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(p.id, p.name)}
                      className="p-1.5 rounded-lg hover:bg-accent-red/20 text-accent-red transition-colors"
                      aria-label="Borrar par"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </aside>
    </>
  );
};

export default PairsPanel;
