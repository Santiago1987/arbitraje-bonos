import { useEffect, useMemo, useRef, useState } from "react";
import { X, Trash2, Plus, ChevronDown, ChevronRight } from "lucide-react";
import clsx from "clsx";
import type {
  ArbitrageOperation,
  Exercise,
  ExerciseDetail,
  OperationSide,
} from "@arbitraje/shared";
import { useMarketStore } from "../../store/marketStore";
import {
  closeExercise,
  createOperation,
  deleteOperation,
  fetchExerciseDetail,
  fetchExercisesForPair,
  openExercise,
} from "../../services/api";

interface Props {
  open: boolean;
  pairId: string | null;
  onClose: () => void;
}

const numberFmt = new Intl.NumberFormat("es-AR", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

const integerFmt = new Intl.NumberFormat("es-AR", {
  maximumFractionDigits: 0,
});

const ratioFmt = new Intl.NumberFormat("es-AR", {
  maximumFractionDigits: 5,
  minimumFractionDigits: 5,
});

const formatNumber = (n: number | null | undefined): string => {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return numberFmt.format(n);
};

const formatInteger = (n: number): string => integerFmt.format(n);

const formatRatio = (n: number | null | undefined): string => {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return ratioFmt.format(n);
};

const formatDateTime = (d: Date | string): string => {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatDate = (d: Date | string): string => {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("es-AR");
};

const isToday = (d: Date | string): boolean => {
  const date = typeof d === "string" ? new Date(d) : d;
  const today = new Date();
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
};

const SIDE_LABELS: Record<OperationSide, string> = {
  buy_ratio: "Compro ratio",
  sell_ratio: "Vendo ratio",
};

// Mismas constantes que el backend (`arbitrage-operations.service.ts`).
// Si cambia una, cambian las dos. Solo se usan acá para el simulador.
const OPERATION_FEE_FACTOR = 1.0001;
const PRICE_DIVISOR = 100;

const legCashFlow = (signedNominals: number, price: number): number => {
  if (signedNominals === 0) return 0;
  const base = (signedNominals * price) / PRICE_DIVISOR;
  if (signedNominals > 0) return -base * OPERATION_FEE_FACTOR;
  return -base / OPERATION_FEE_FACTOR;
};

const OperationsPanel = ({ open, pairId, onClose }: Props) => {
  const pair = useMarketStore((s) =>
    pairId ? (s.pairs.find((p) => p.id === pairId) ?? null) : null,
  );
  const live = useMarketStore((s) =>
    pairId ? (s.liveData[pairId] ?? null) : null,
  );
  const setPairExerciseOpen = useMarketStore((s) => s.setPairExerciseOpen);

  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [detail, setDetail] = useState<ExerciseDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pastExpanded, setPastExpanded] = useState(false);
  const [viewingExerciseId, setViewingExerciseId] = useState<string | null>(
    null,
  );

  // Modal abrir ejercicio
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [openName, setOpenName] = useState("");
  const [openNotes, setOpenNotes] = useState("");

  // Form nueva operación. La pata "principal" es la que se vende (la que
  // genera el cash con el que se compra la otra). El nominal de la pata
  // comprada se autosugiere cuando el usuario completa el nominal de la
  // vendida + ambos precios; sigue siendo editable.
  const [side, setSide] = useState<OperationSide>("buy_ratio");
  const [nominalsA, setNominalsA] = useState("");
  const [nominalsB, setNominalsB] = useState("");
  // Marca cuál de los dos inputs editó el usuario manualmente último, para no
  // pisarlo con el autosuggest.
  const [nominalsAEdited, setNominalsAEdited] = useState(false);
  const [nominalsBEdited, setNominalsBEdited] = useState(false);
  const [priceA, setPriceA] = useState("");
  const [priceB, setPriceB] = useState("");
  const [opNotes, setOpNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // buy_ratio  → vendo B (pata principal) + compro A (autosugerido)
  // sell_ratio → vendo A (pata principal) + compro B (autosugerido)
  const sellLeg: "A" | "B" = side === "buy_ratio" ? "B" : "A";

  // Autosuggest: si el usuario completó la pata vendida + los dos precios y
  // todavía no tocó la pata comprada, calcular nominales para que los montos
  // se equilibren: nominalesComprada = round(nominalesVendida × precioVendida
  // / precioComprada).
  useEffect(() => {
    const a = Number(priceA);
    const b = Number(priceB);
    if (!a || !b) return;
    if (sellLeg === "B") {
      // vendo B → autosuggest A
      const nb = Number(nominalsB);
      if (!nb || nominalsAEdited) return;
      const suggested = Math.round((nb * b) / a);
      setNominalsA(String(suggested));
    } else {
      const na = Number(nominalsA);
      if (!na || nominalsBEdited) return;
      const suggested = Math.round((na * a) / b);
      setNominalsB(String(suggested));
    }
  }, [
    sellLeg,
    nominalsA,
    nominalsB,
    nominalsAEdited,
    nominalsBEdited,
    priceA,
    priceB,
  ]);

  // Simulador
  const [simPriceA, setSimPriceA] = useState("");
  const [simPriceB, setSimPriceB] = useState("");

  // Cerrar ejercicio
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closeNotes, setCloseNotes] = useState("");

  const openExerciseRow = useMemo(
    () => exercises.find((e) => e.status === "open") ?? null,
    [exercises],
  );

  const closedExercises = useMemo(
    () => exercises.filter((e) => e.status === "closed"),
    [exercises],
  );

  // El detalle visible: el ejercicio abierto por default; o el viejo elegido.
  const visibleExerciseId = viewingExerciseId ?? openExerciseRow?.id ?? null;

  // ---- Cargar ejercicios cuando se abre el panel o cambia el par ----
  useEffect(() => {
    if (!open || !pairId) {
      setExercises([]);
      setDetail(null);
      setViewingExerciseId(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetchExercisesForPair(pairId)
      .then((rows) => {
        setExercises(rows);
        setViewingExerciseId(null); // resetear: al cambiar de par mostrar el abierto
        setPairExerciseOpen(
          pairId,
          rows.some((e) => e.status === "open"),
        );
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Error cargando ejercicios"),
      )
      .finally(() => setLoading(false));
  }, [open, pairId, setPairExerciseOpen]);

  // ---- Cargar detalle del ejercicio visible ----
  useEffect(() => {
    if (!visibleExerciseId) {
      setDetail(null);
      return;
    }
    fetchExerciseDetail(visibleExerciseId)
      .then(setDetail)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Error cargando detalle"),
      );
  }, [visibleExerciseId]);

  const closingOpIds = useMemo(() => {
    if (!detail) return new Set<string>();
    return new Set(detail.state.cycles.map((c) => c.closedAtOperationId));
  }, [detail]);

  const cycleByOpId = useMemo(() => {
    if (!detail) return new Map<string, number>();
    return new Map(
      detail.state.cycles.map((c) => [c.closedAtOperationId, c.pnl]),
    );
  }, [detail]);

  const calculatedRatio = useMemo(() => {
    const a = Number(priceA);
    const b = Number(priceB);
    if (!a || !b) return null;
    return a / b;
  }, [priceA, priceB]);

  const totalPairPnL = useMemo(() => {
    const closed = closedExercises.reduce((acc, e) => acc + e.realizedPnL, 0);
    const current = openExerciseRow?.realizedPnL ?? 0;
    return closed + current;
  }, [closedExercises, openExerciseRow]);

  const todayPnL = useMemo(() => {
    if (!detail) return 0;
    return detail.state.cycles
      .filter((c) => isToday(c.closedAt))
      .reduce((acc, c) => acc + c.pnl, 0);
  }, [detail]);

  // PnL hipotético si se cerrara el ciclo abierto a esos precios.
  // Cerrar = ejecutar la operación opuesta (-netA, -netB) a los precios sim.
  // Cash flow del cierre por pata = legCashFlow(-net, simPrice).
  const hypotheticalCloseValue = useMemo(() => {
    if (!detail) return null;
    const a = Number(simPriceA);
    const b = Number(simPriceB);
    if (!a || !b) return null;
    const { netNominalsA, netNominalsB, openCycleCashFlow } = detail.state;
    return (
      openCycleCashFlow +
      legCashFlow(-netNominalsA, a) +
      legCashFlow(-netNominalsB, b)
    );
  }, [detail, simPriceA, simPriceB]);

  const simulatedRatio = useMemo(() => {
    const a = Number(simPriceA);
    const b = Number(simPriceB);
    if (!a || !b) return null;
    return a / b;
  }, [simPriceA, simPriceB]);

  const isReadOnly = !!viewingExerciseId; // viendo un ejercicio cerrado

  // ---- Handlers ----

  const refreshAll = async () => {
    if (!pairId) return;
    const list = await fetchExercisesForPair(pairId);
    setExercises(list);
    setPairExerciseOpen(
      pairId,
      list.some((e) => e.status === "open"),
    );
    if (visibleExerciseId) {
      const updated = await fetchExerciseDetail(visibleExerciseId);
      setDetail(updated);
    }
  };

  const handleOpenExercise = async () => {
    if (!pairId || !openName.trim()) return;
    setError(null);
    try {
      await openExercise(pairId, {
        name: openName.trim(),
        openingNotes: openNotes.trim(),
      });
      setShowOpenModal(false);
      setOpenName("");
      setOpenNotes("");
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error abriendo ejercicio");
    }
  };

  const handleCloseExercise = async () => {
    if (!openExerciseRow) return;
    setError(null);
    try {
      await closeExercise(openExerciseRow.id, closeNotes.trim());
      setShowCloseModal(false);
      setCloseNotes("");
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cerrando ejercicio");
    }
  };

  const handleAutoFill = () => {
    if (!live) return;
    // Compro ratio = compro A (uso ask de A) y vendo B (uso bid de B)
    // Vendo ratio = vendo A (uso bid de A) y compro B (uso ask de B)
    if (side === "buy_ratio") {
      if (live.askA) setPriceA(String(live.askA));
      if (live.bidB) setPriceB(String(live.bidB));
    } else {
      if (live.bidA) setPriceA(String(live.bidA));
      if (live.askB) setPriceB(String(live.askB));
    }
  };

  const resetForm = () => {
    setNominalsA("");
    setNominalsB("");
    setNominalsAEdited(false);
    setNominalsBEdited(false);
    setPriceA("");
    setPriceB("");
    setOpNotes("");
  };

  const handleSubmitOperation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!openExerciseRow) return;
    const na = Number(nominalsA);
    const nb = Number(nominalsB);
    const a = Number(priceA);
    const b = Number(priceB);
    if (!na || !nb || !a || !b) {
      setError("Completá nominales A, nominales B, precio A y precio B");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createOperation(openExerciseRow.id, {
        side,
        nominalsA: na,
        nominalsB: nb,
        priceA: a,
        priceB: b,
        notes: opNotes.trim() || undefined,
      });
      resetForm();
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error creando operación");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteOperation = async (op: ArbitrageOperation) => {
    if (!confirm(`¿Borrar la operación del ${formatDateTime(op.timestamp)}?`)) {
      return;
    }
    setError(null);
    try {
      await deleteOperation(op.id);
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error borrando operación");
    }
  };

  const tickerA = pair?.bondA ?? "A";
  const tickerB = pair?.bondB ?? "B";

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
          "absolute top-0 right-0 z-40 h-full w-225 max-w-[95vw] bg-surface-1 border-l border-surface-3/40 shadow-2xl flex flex-col transition-transform duration-200",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-surface-3/40">
          <div>
            <h2 className="text-base font-semibold">
              Operaciones de arbitraje
            </h2>
            <p className="text-xs text-muted mt-0.5">
              {pair ? pair.name : "Seleccioná un par en la tabla"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-surface-2 transition-colors"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="mx-4 mt-3 text-xs text-accent-red bg-accent-red/10 border border-accent-red/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {!pair && (
            <div className="px-4 py-6 text-sm text-muted">
              Elegí un par desde la tabla principal para empezar a registrar
              operaciones.
            </div>
          )}

          {pair && loading && (
            <div className="px-4 py-6 text-sm text-muted">Cargando…</div>
          )}

          {pair && !loading && (
            <>
              {/* Bloque: ejercicio activo */}
              <section className="px-4 py-4 border-b border-surface-3/30">
                <h3 className="text-xs uppercase tracking-wider text-muted mb-2">
                  Ejercicio
                </h3>
                {!openExerciseRow ? (
                  <button
                    onClick={() => setShowOpenModal(true)}
                    className="w-full py-3 rounded-lg bg-accent-blue/15 hover:bg-accent-blue/25 border border-accent-blue/30 text-accent-blue text-sm font-medium transition-colors"
                  >
                    + Abrir ejercicio para {pair.name}
                  </button>
                ) : (
                  <ExerciseHeader
                    exercise={openExerciseRow}
                    detail={detail}
                    tickerA={tickerA}
                    tickerB={tickerB}
                    onClose={() => setShowCloseModal(true)}
                    isViewingHistorical={!!viewingExerciseId}
                  />
                )}
              </section>

              {/* Selector ejercicio histórico — sólo si hay alguno cerrado */}
              {viewingExerciseId && detail && (
                <section className="px-4 py-2 bg-surface-2/40 border-b border-surface-3/30 flex items-center justify-between">
                  <div className="text-xs">
                    Viendo ejercicio cerrado:{" "}
                    <span className="font-semibold">
                      {detail.exercise.name}
                    </span>
                  </div>
                  <button
                    onClick={() => setViewingExerciseId(null)}
                    className="text-xs text-accent-blue hover:underline"
                  >
                    Volver al actual
                  </button>
                </section>
              )}

              {/* Form nueva operación */}
              {openExerciseRow && !isReadOnly && (
                <section className="px-4 py-4 border-b border-surface-3/30">
                  <h3 className="text-xs uppercase tracking-wider text-muted mb-2">
                    Nueva operación
                  </h3>
                  <form onSubmit={handleSubmitOperation} className="space-y-3">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setSide("buy_ratio")}
                        className={clsx(
                          "flex-1 py-2 rounded-lg text-sm font-medium transition-colors",
                          side === "buy_ratio"
                            ? "bg-accent-green/15 text-accent-green border border-accent-green/30"
                            : "bg-surface-2 text-muted hover:text-white border border-transparent",
                        )}
                      >
                        Compro ratio
                        <span className="block text-[10px] font-normal opacity-70">
                          compro {tickerA} · vendo {tickerB}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSide("sell_ratio")}
                        className={clsx(
                          "flex-1 py-2 rounded-lg text-sm font-medium transition-colors",
                          side === "sell_ratio"
                            ? "bg-accent-red/15 text-accent-red border border-accent-red/30"
                            : "bg-surface-2 text-muted hover:text-white border border-transparent",
                        )}
                      >
                        Vendo ratio
                        <span className="block text-[10px] font-normal opacity-70">
                          vendo {tickerA} · compro {tickerB}
                        </span>
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <LegInputs
                        ticker={tickerA}
                        action={sellLeg === "A" ? "vende" : "compra"}
                        nominals={nominalsA}
                        onNominalsChange={(v) => {
                          setNominalsA(v);
                          setNominalsAEdited(true);
                        }}
                        autoSuggested={
                          sellLeg === "B" && !nominalsAEdited && !!nominalsA
                        }
                        price={priceA}
                        onPriceChange={setPriceA}
                        nominalsPlaceholder={sellLeg === "A" ? "10000" : "auto"}
                        pricePlaceholder="104650"
                      />
                      <LegInputs
                        ticker={tickerB}
                        action={sellLeg === "B" ? "vende" : "compra"}
                        nominals={nominalsB}
                        onNominalsChange={(v) => {
                          setNominalsB(v);
                          setNominalsBEdited(true);
                        }}
                        autoSuggested={
                          sellLeg === "A" && !nominalsBEdited && !!nominalsB
                        }
                        price={priceB}
                        onPriceChange={setPriceB}
                        nominalsPlaceholder={sellLeg === "B" ? "10000" : "auto"}
                        pricePlaceholder="103900"
                      />
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <div className="text-muted">
                        Ratio:{" "}
                        <span className="font-mono text-white">
                          {formatRatio(calculatedRatio)}
                        </span>
                        {live && (
                          <span className="ml-3 text-muted">
                            Mercado: compra{" "}
                            <span className="font-mono text-accent-green">
                              {live.askA && live.bidB
                                ? formatRatio(live.askA / live.bidB)
                                : "—"}
                            </span>{" "}
                            · venta{" "}
                            <span className="font-mono text-accent-red">
                              {live.bidA && live.askB
                                ? formatRatio(live.bidA / live.askB)
                                : "—"}
                            </span>
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={handleAutoFill}
                        disabled={!live}
                        className="px-2 py-1 rounded text-xs bg-surface-2 hover:bg-surface-3 disabled:opacity-40 transition-colors"
                      >
                        Auto (bid/ask)
                      </button>
                    </div>

                    <input
                      type="text"
                      value={opNotes}
                      onChange={(e) => setOpNotes(e.target.value)}
                      placeholder="Notas (opcional)"
                      className="w-full px-2 py-1.5 rounded-lg bg-surface-2 border border-surface-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue"
                    />

                    <button
                      type="submit"
                      disabled={submitting || !openExerciseRow}
                      className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-accent-blue hover:bg-accent-blue/80 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      {submitting ? "Guardando…" : "Guardar operación"}
                    </button>
                  </form>
                </section>
              )}

              {/* Tabla operaciones */}
              {detail && detail.operations.length > 0 && (
                <section className="px-4 py-4 border-b border-surface-3/30">
                  <h3 className="text-xs uppercase tracking-wider text-muted mb-2">
                    Operaciones ({detail.operations.length})
                  </h3>
                  <OperationsTable
                    operations={detail.operations}
                    closingOpIds={closingOpIds}
                    cyclePnLs={cycleByOpId}
                    tickerA={tickerA}
                    tickerB={tickerB}
                    onDelete={isReadOnly ? undefined : handleDeleteOperation}
                  />
                </section>
              )}

              {/* PnL summary + simulador */}
              {detail && (
                <section className="px-4 py-4 border-b border-surface-3/30 grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="text-xs uppercase tracking-wider text-muted mb-2">
                      Resultados
                    </h3>
                    <div className="space-y-1.5 text-sm">
                      <PnLRow
                        label="Ejercicio (realizado)"
                        value={detail.state.realizedPnL}
                      />
                      <PnLRow
                        label="Ciclo abierto (cash flow)"
                        value={detail.state.openCycleCashFlow}
                        muted={detail.state.openCycleCashFlow === 0}
                      />
                      <PnLRow label="Hoy" value={todayPnL} />
                      <PnLRow
                        label={`Total ${pair.name}`}
                        value={totalPairPnL}
                        emphasized
                      />
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xs uppercase tracking-wider text-muted mb-2">
                      Simulador
                    </h3>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        step="any"
                        value={simPriceA}
                        onChange={(e) => setSimPriceA(e.target.value)}
                        placeholder={`Precio ${tickerA}`}
                        className="w-full px-2 py-1.5 rounded-lg bg-surface-2 border border-surface-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue"
                      />
                      <input
                        type="number"
                        step="any"
                        value={simPriceB}
                        onChange={(e) => setSimPriceB(e.target.value)}
                        placeholder={`Precio ${tickerB}`}
                        className="w-full px-2 py-1.5 rounded-lg bg-surface-2 border border-surface-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue"
                      />
                    </div>
                    <div className="mt-2 text-xs space-y-1">
                      <div className="flex justify-between">
                        <span className="text-muted">Ratio simulado</span>
                        <span className="font-mono">
                          {formatRatio(simulatedRatio)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted">
                          PnL si cierro a esos precios
                        </span>
                        <span
                          className={clsx(
                            "font-mono font-semibold",
                            hypotheticalCloseValue === null
                              ? ""
                              : hypotheticalCloseValue >= 0
                                ? "text-accent-green"
                                : "text-accent-red",
                          )}
                        >
                          {hypotheticalCloseValue === null
                            ? "—"
                            : formatNumber(hypotheticalCloseValue)}
                        </span>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* Ejercicios pasados */}
              {closedExercises.length > 0 && (
                <section className="px-4 py-4">
                  <button
                    onClick={() => setPastExpanded((v) => !v)}
                    className="w-full flex items-center gap-2 text-xs uppercase tracking-wider text-muted hover:text-white transition-colors"
                  >
                    {pastExpanded ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                    Ejercicios pasados ({closedExercises.length})
                  </button>
                  {pastExpanded && (
                    <ul className="mt-3 space-y-1.5">
                      {closedExercises.map((e) => (
                        <li
                          key={e.id}
                          className={clsx(
                            "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs cursor-pointer transition-colors",
                            viewingExerciseId === e.id
                              ? "bg-accent-blue/15"
                              : "bg-surface-2/60 hover:bg-surface-2",
                          )}
                          onClick={() => setViewingExerciseId(e.id)}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold truncate">
                              {e.name}
                            </div>
                            <div className="text-muted">
                              {formatDate(e.openedAt)} →{" "}
                              {e.closedAt ? formatDate(e.closedAt) : "—"}
                            </div>
                          </div>
                          <div
                            className={clsx(
                              "font-mono font-semibold",
                              e.realizedPnL >= 0
                                ? "text-accent-green"
                                : "text-accent-red",
                            )}
                          >
                            {formatNumber(e.realizedPnL)}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </aside>

      {/* Modal abrir ejercicio */}
      {showOpenModal && (
        <Modal
          title="Abrir ejercicio"
          onClose={() => setShowOpenModal(false)}
          onConfirm={handleOpenExercise}
          confirmLabel="Abrir"
          confirmDisabled={!openName.trim()}
        >
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-muted mb-1">Nombre</label>
              <input
                type="text"
                autoFocus
                value={openName}
                onChange={(e) => setOpenName(e.target.value)}
                placeholder="Ej: Mayo 2026"
                className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-surface-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">
                Notas (opcional)
              </label>
              <textarea
                rows={3}
                value={openNotes}
                onChange={(e) => setOpenNotes(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-surface-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue resize-none"
              />
            </div>
          </div>
        </Modal>
      )}

      {/* Modal cerrar ejercicio */}
      {showCloseModal && openExerciseRow && (
        <Modal
          title={`Cerrar "${openExerciseRow.name}"`}
          onClose={() => setShowCloseModal(false)}
          onConfirm={handleCloseExercise}
          confirmLabel="Cerrar ejercicio"
          confirmVariant="danger"
        >
          <div className="space-y-3">
            <p className="text-xs text-muted">
              Una vez cerrado no se pueden agregar ni editar operaciones.
            </p>
            <div>
              <label className="block text-xs text-muted mb-1">
                Notas de cierre (opcional)
              </label>
              <textarea
                rows={3}
                value={closeNotes}
                onChange={(e) => setCloseNotes(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-surface-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue resize-none"
              />
            </div>
          </div>
        </Modal>
      )}
    </>
  );
};

// ====================================================================

interface ExerciseHeaderProps {
  exercise: Exercise;
  detail: ExerciseDetail | null;
  tickerA: string;
  tickerB: string;
  onClose: () => void;
  isViewingHistorical: boolean;
}

const ExerciseHeader = ({
  exercise,
  detail,
  tickerA,
  tickerB,
  onClose,
  isViewingHistorical,
}: ExerciseHeaderProps) => {
  const state = detail?.state;
  return (
    <div className="bg-surface-2/40 rounded-lg p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold truncate">{exercise.name}</div>
          <div className="text-xs text-muted">
            Abierto: {formatDateTime(exercise.openedAt)}
          </div>
        </div>
        {!isViewingHistorical && (
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs bg-accent-amber/15 hover:bg-accent-amber/25 text-accent-amber border border-accent-amber/30 transition-colors"
          >
            Cerrar ejercicio
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <div className="text-muted">
            Falta {/* operar */} en {tickerA}
          </div>
          <div
            className={clsx(
              "font-mono font-semibold",
              state && Math.abs(state.netNominalsA) > 1e-6
                ? state.netNominalsA > 0
                  ? "text-accent-amber"
                  : "text-accent-blue"
                : "text-accent-green",
            )}
          >
            {state ? netLabel(state.netNominalsA) : "—"}
          </div>
        </div>
        <div>
          <div className="text-muted">
            Falta {/* operar */} en {tickerB}
          </div>
          <div
            className={clsx(
              "font-mono font-semibold",
              state && Math.abs(state.netNominalsB) > 1e-6
                ? state.netNominalsB > 0
                  ? "text-accent-amber"
                  : "text-accent-blue"
                : "text-accent-green",
            )}
          >
            {state ? netLabel(state.netNominalsB) : "—"}
          </div>
        </div>
      </div>
    </div>
  );
};

// netNominals positivo = compré en exceso → falta vender; negativo = vendí en
// exceso → falta comprar. Cero = balanceado.
const netLabel = (net: number): string => {
  if (Math.abs(net) < 1e-6) return "Balanceado";
  if (net > 0) return `Falta vender ${formatInteger(net)}`;
  return `Falta comprar ${formatInteger(-net)}`;
};

// ====================================================================

interface LegInputsProps {
  ticker: string;
  action: "vende" | "compra";
  nominals: string;
  onNominalsChange: (v: string) => void;
  autoSuggested: boolean;
  price: string;
  onPriceChange: (v: string) => void;
  nominalsPlaceholder: string;
  pricePlaceholder: string;
}

const LegInputs = ({
  ticker,
  action,
  nominals,
  onNominalsChange,
  autoSuggested,
  price,
  onPriceChange,
  nominalsPlaceholder,
  pricePlaceholder,
}: LegInputsProps) => {
  const isSell = action === "vende";
  return (
    <div
      className={clsx(
        "rounded-lg border p-2 space-y-2",
        isSell
          ? "border-accent-red/30 bg-accent-red/5"
          : "border-accent-green/30 bg-accent-green/5",
      )}
    >
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider">
        <span className="font-semibold">{ticker}</span>
        <span className={isSell ? "text-accent-red" : "text-accent-green"}>
          {action}
        </span>
      </div>
      <div>
        <label className="block text-[10px] uppercase text-muted mb-1">
          Nominales {autoSuggested && "(auto)"}
        </label>
        <input
          type="number"
          step="any"
          value={nominals}
          onChange={(e) => onNominalsChange(e.target.value)}
          placeholder={nominalsPlaceholder}
          className={clsx(
            "w-full px-2 py-1.5 rounded-lg bg-surface-2 border text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue",
            autoSuggested ? "border-accent-blue/40" : "border-surface-3",
          )}
        />
      </div>
      <div>
        <label className="block text-[10px] uppercase text-muted mb-1">
          Precio
        </label>
        <input
          type="number"
          step="any"
          value={price}
          onChange={(e) => onPriceChange(e.target.value)}
          placeholder={pricePlaceholder}
          className="w-full px-2 py-1.5 rounded-lg bg-surface-2 border border-surface-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue"
        />
      </div>
    </div>
  );
};

// ====================================================================

interface OperationsTableProps {
  operations: ArbitrageOperation[];
  closingOpIds: Set<string>;
  cyclePnLs: Map<string, number>;
  tickerA: string;
  tickerB: string;
  onDelete?: (op: ArbitrageOperation) => void;
}

const OperationsTable = ({
  operations,
  closingOpIds,
  cyclePnLs,
  tickerA,
  tickerB,
  onDelete,
}: OperationsTableProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Al montar o cambiar el set de operaciones, dejar el scroll en la última fila.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [operations]);

  return (
    <div
      ref={scrollRef}
      className="overflow-x-auto overflow-y-auto h-70 rounded-lg border border-surface-3/30"
    >
      <table className="w-full text-xs">
        <thead className="bg-surface-2/60 text-muted">
          <tr>
            <th className="text-left px-2 py-1.5">Fecha</th>
            <th className="text-left px-2 py-1.5">Lado</th>
            <th className="text-right px-2 py-1.5">Nom. {tickerA}</th>
            <th className="text-right px-2 py-1.5">Precio {tickerA}</th>
            <th className="text-right px-2 py-1.5">Nom. {tickerB}</th>
            <th className="text-right px-2 py-1.5">Precio {tickerB}</th>
            <th className="text-right px-2 py-1.5">Ratio</th>
            <th className="text-right px-2 py-1.5">PnL ciclo</th>
            {onDelete && <th className="px-2 py-1.5" />}
          </tr>
        </thead>
        <tbody>
          {operations.map((op) => {
            const closes = closingOpIds.has(op.id);
            const pnl = cyclePnLs.get(op.id);
            return (
              <tr
                key={op.id}
                className={clsx(
                  "border-t border-surface-3/20",
                  closes && "bg-accent-green/5",
                )}
              >
                <td className="px-2 py-1.5 whitespace-nowrap">
                  {formatDateTime(op.timestamp)}
                </td>
                <td className="px-2 py-1.5">
                  <span
                    className={clsx(
                      "px-1.5 py-0.5 rounded text-[10px] font-semibold",
                      op.side === "buy_ratio"
                        ? "bg-accent-green/10 text-accent-green"
                        : "bg-accent-red/10 text-accent-red",
                    )}
                  >
                    {SIDE_LABELS[op.side]}
                  </span>
                </td>
                <td
                  className={clsx(
                    "px-2 py-1.5 text-right font-mono",
                    op.nominalsA > 0 ? "text-accent-green" : "text-accent-red",
                  )}
                >
                  {formatInteger(op.nominalsA)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono">
                  {formatNumber(op.priceA)}
                </td>
                <td
                  className={clsx(
                    "px-2 py-1.5 text-right font-mono",
                    op.nominalsB > 0 ? "text-accent-green" : "text-accent-red",
                  )}
                >
                  {formatInteger(op.nominalsB)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono">
                  {formatNumber(op.priceB)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono">
                  {formatRatio(op.executedRatio)}
                </td>
                <td
                  className={clsx(
                    "px-2 py-1.5 text-right font-mono font-semibold",
                    pnl === undefined
                      ? "text-muted"
                      : pnl >= 0
                        ? "text-accent-green"
                        : "text-accent-red",
                  )}
                >
                  {pnl === undefined ? "" : formatNumber(pnl)}
                </td>
                {onDelete && (
                  <td className="px-2 py-1.5">
                    <button
                      onClick={() => onDelete(op)}
                      className="p-1 rounded hover:bg-accent-red/20 text-accent-red transition-colors"
                      aria-label="Borrar"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// ====================================================================

interface PnLRowProps {
  label: string;
  value: number;
  emphasized?: boolean;
  muted?: boolean;
}

const PnLRow = ({ label, value, emphasized, muted }: PnLRowProps) => {
  const positive = value >= 0;
  return (
    <div
      className={clsx(
        "flex justify-between items-baseline",
        emphasized && "pt-1.5 border-t border-surface-3/30",
      )}
    >
      <span className={clsx("text-xs", muted ? "text-muted" : "text-muted")}>
        {label}
      </span>
      <span
        className={clsx(
          "font-mono",
          emphasized ? "text-base font-semibold" : "text-sm",
          muted
            ? "text-muted"
            : positive
              ? "text-accent-green"
              : "text-accent-red",
        )}
      >
        {formatNumber(value)}
      </span>
    </div>
  );
};

// ====================================================================

interface ModalProps {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
  confirmVariant?: "primary" | "danger";
  confirmDisabled?: boolean;
}

const Modal = ({
  title,
  children,
  onClose,
  onConfirm,
  confirmLabel = "Confirmar",
  confirmVariant = "primary",
  confirmDisabled,
}: ModalProps) => {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        className="bg-surface-1 border border-surface-3/40 rounded-xl shadow-2xl w-full max-w-md p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">{title}</h3>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-2"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm bg-surface-2 hover:bg-surface-3 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={clsx(
              "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50",
              confirmVariant === "danger"
                ? "bg-accent-red hover:bg-accent-red/80 text-white"
                : "bg-accent-blue hover:bg-accent-blue/80 text-white",
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OperationsPanel;
