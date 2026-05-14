import { useEffect, useLayoutEffect, useRef, useState } from "react";
import RatioChart from "../dashboard/RatioChart";
import { PairCombobox } from "./PairCombobox";

const CELL_COUNT = 6;
const STORAGE_KEY = "multicharts:pairIds";
// Header de cada celda (selector + chrome del RatioChart) — el chart usa el
// alto restante. Ajustá si cambia el padding/margenes de la celda.
const CELL_CHROME_PX = 110;
const MIN_CHART_HEIGHT = 180;

type CellPairIds = Array<string | null>;

const loadInitial = (): CellPairIds => {
  if (typeof window === "undefined") return Array(CELL_COUNT).fill(null);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return Array(CELL_COUNT).fill(null);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return Array(CELL_COUNT).fill(null);
    const normalized: CellPairIds = Array(CELL_COUNT).fill(null);
    for (let i = 0; i < CELL_COUNT; i++) {
      const v = parsed[i];
      normalized[i] = typeof v === "string" && v.length > 0 ? v : null;
    }
    return normalized;
  } catch {
    return Array(CELL_COUNT).fill(null);
  }
};

export const MultiChartsView = () => {
  const [cellPairIds, setCellPairIds] = useState<CellPairIds>(() =>
    loadInitial(),
  );
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [chartHeight, setChartHeight] = useState<number>(MIN_CHART_HEIGHT);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cellPairIds));
    } catch {
      // localStorage puede estar deshabilitado — ignorar silenciosamente.
    }
  }, [cellPairIds]);

  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;

    const recompute = () => {
      // Grid 3 filas con gap-2 (8px) → 2 gaps internos = 16px.
      const rows = 3;
      const gapPx = 8 * (rows - 1);
      const usable = el.clientHeight - gapPx;
      const perRow = Math.floor(usable / rows);
      const next = Math.max(MIN_CHART_HEIGHT, perRow - CELL_CHROME_PX) + 100;
      setChartHeight(next);
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const setCell = (idx: number, pairId: string | null) => {
    setCellPairIds((prev) => {
      const next = [...prev];
      next[idx] = pairId;
      return next;
    });
  };

  return (
    <div
      ref={gridRef}
      className="grid grid-cols-2 grid-rows-3 p-2 h-[calc(100dvh-4rem)]"
    >
      {cellPairIds.map((pairId, idx) => (
        <div
          key={idx}
          className="bg-surface-1 border border-surface-3/30 p-2 flex flex-col min-h-0 overflow-hidden"
        >
          <PairCombobox
            value={pairId}
            onChange={(next) => setCell(idx, next)}
            placeholder={`Cuadro ${idx + 1} — seleccioná un par…`}
          />
          {pairId ? (
            <div className="flex-1 min-h-0">
              <RatioChart pairId={pairId} height={chartHeight} />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted text-sm">
              Seleccioná un par para ver su ratio
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default MultiChartsView;
