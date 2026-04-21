import { useEffect, useMemo, useState } from "react";
import { X, Trash2, Volume2, VolumeX, Plus } from "lucide-react";
import clsx from "clsx";
import type { AlertCondition, AlertField } from "@arbitraje/shared";
import { useMarketStore } from "../../store/marketStore";
import { createAlert, deleteAlert, fetchAlerts } from "../../services/api";
import {
  isAudioUnlocked,
  playAlertSound,
  unlockAudio,
} from "../../services/sound";

interface Props {
  open: boolean;
  onClose: () => void;
}

const FIELD_LABELS: Record<AlertField, string> = {
  ratio: "Ratio (A/B)",
  spread: "Spread (A−B)",
  priceA: "Precio A",
  priceB: "Precio B",
};

const CONDITION_LABELS: Record<AlertCondition, string> = {
  above: "Mayor a (>)",
  below: "Menor a (<)",
  cross_above: "Cruza hacia arriba",
  cross_below: "Cruza hacia abajo",
};

const AlertsPanel = ({ open, onClose }: Props) => {
  const pairs = useMarketStore((s) => s.pairs);
  const selectedPairId = useMarketStore((s) => s.selectedPairId);
  const alertConfigs = useMarketStore((s) => s.alertConfigs);
  const setAlertConfigs = useMarketStore((s) => s.setAlertConfigs);
  const upsertAlertConfig = useMarketStore((s) => s.upsertAlertConfig);
  const removeAlertConfig = useMarketStore((s) => s.removeAlertConfig);

  const [pairId, setPairId] = useState<string>("");
  const [field, setField] = useState<AlertField>("ratio");
  const [condition, setCondition] = useState<AlertCondition>("above");
  const [threshold, setThreshold] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioUnlocked, setAudioUnlocked] = useState(isAudioUnlocked());

  // Cargar alertas la primera vez que se abre
  useEffect(() => {
    if (!open) return;
    fetchAlerts()
      .then(setAlertConfigs)
      .catch(() => {});
  }, [open, setAlertConfigs]);

  // Pre-seleccionar el par si hay uno marcado en la tabla
  useEffect(() => {
    if (!open) return;
    if (selectedPairId && !pairId) setPairId(selectedPairId);
    if (!selectedPairId && !pairId && pairs.length > 0) setPairId(pairs[0].id);
  }, [open, selectedPairId, pairs, pairId]);

  const canSubmit = useMemo(
    () =>
      pairId !== "" &&
      threshold.trim() !== "" &&
      !Number.isNaN(Number(threshold)),
    [pairId, threshold],
  );

  const handleTestSound = () => {
    const ok = unlockAudio();
    setAudioUnlocked(ok);
    if (ok) playAlertSound();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const created = await createAlert({
        pairId,
        field,
        condition,
        threshold: Number(threshold),
        message: message.trim() || undefined,
      });
      upsertAlertConfig(created);
      setThreshold("");
      setMessage("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear alerta");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteAlert(id);
      removeAlertConfig(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al borrar alerta");
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
          <h2 className="text-base font-semibold">Alertas</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-surface-2 transition-colors"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {/* Sound state */}
          <div className="px-4 py-3 border-b border-surface-3/30">
            <button
              onClick={handleTestSound}
              className={clsx(
                "w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
                audioUnlocked
                  ? "bg-surface-2 hover:bg-surface-3"
                  : "bg-accent-amber/10 hover:bg-accent-amber/20 border border-accent-amber/30",
              )}
            >
              {audioUnlocked ? (
                <Volume2 className="w-4 h-4 text-accent-green" />
              ) : (
                <VolumeX className="w-4 h-4 text-accent-amber" />
              )}
              {audioUnlocked ? "Probar sonido" : "Activar sonido"}
            </button>
            {!audioUnlocked && (
              <p className="text-xs text-muted mt-2">
                El navegador requiere un click para habilitar el audio.
              </p>
            )}
          </div>

          {/* Form */}
          <form
            onSubmit={handleSubmit}
            className="px-4 py-3 space-y-3 border-b border-surface-3/30"
          >
            <div>
              <label className="block text-xs text-muted mb-1">Par</label>
              <select
                value={pairId}
                onChange={(e) => setPairId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-surface-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue"
              >
                {pairs.length === 0 && <option value="">Sin pares</option>}
                {pairs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-muted mb-1">Campo</label>
              <select
                value={field}
                onChange={(e) => setField(e.target.value as AlertField)}
                className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-surface-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue"
              >
                {(Object.keys(FIELD_LABELS) as AlertField[]).map((f) => (
                  <option key={f} value={f}>
                    {FIELD_LABELS[f]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-muted mb-1">Condición</label>
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value as AlertCondition)}
                className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-surface-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue"
              >
                {(Object.keys(CONDITION_LABELS) as AlertCondition[]).map(
                  (c) => (
                    <option key={c} value={c}>
                      {CONDITION_LABELS[c]}
                    </option>
                  ),
                )}
              </select>
            </div>

            <div>
              <label className="block text-xs text-muted mb-1">Umbral</label>
              <input
                type="number"
                step="any"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                placeholder="Ej: 1.45"
                className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-surface-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue"
              />
            </div>

            <div>
              <label className="block text-xs text-muted mb-1">
                Mensaje (opcional)
              </label>
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Texto a mostrar"
                className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-surface-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue"
              />
            </div>

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
              {submitting ? "Creando..." : "Crear alerta"}
            </button>
          </form>

          {/* Lista de alertas activas */}
          <div className="px-4 py-3">
            <h3 className="text-xs uppercase tracking-wider text-muted mb-2">
              Alertas configuradas ({alertConfigs.length})
            </h3>
            {alertConfigs.length === 0 ? (
              <p className="text-xs text-muted py-2">
                Sin alertas configuradas.
              </p>
            ) : (
              <ul className="space-y-2">
                {alertConfigs.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-2 bg-surface-2/60 rounded-lg px-3 py-2 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-mono font-semibold truncate">
                        {a.pairName}
                      </div>
                      <div className="text-muted truncate">
                        {FIELD_LABELS[a.field]} {CONDITION_LABELS[a.condition]}{" "}
                        <span className="text-white">{a.threshold}</span>
                      </div>
                      <div
                        className={clsx(
                          "mt-0.5 inline-block px-1.5 py-0.5 rounded text-[10px]",
                          a.status === "active" &&
                            "bg-accent-green/10 text-accent-green",
                          a.status === "triggered" &&
                            "bg-accent-amber/10 text-accent-amber",
                          a.status === "disabled" && "bg-surface-3 text-muted",
                        )}
                      >
                        {a.status}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(a.id)}
                      className="p-1.5 rounded-lg hover:bg-accent-red/20 text-accent-red transition-colors"
                      aria-label="Borrar alerta"
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

export default AlertsPanel;
