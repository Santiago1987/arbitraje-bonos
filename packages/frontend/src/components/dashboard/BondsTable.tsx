import { useEffect, useRef, useState } from "react";
import { Activity } from "lucide-react";
import clsx from "clsx";
import type { BondPair } from "@arbitraje/shared";
import {
  useMarketStore,
  selectLiveByPair,
  selectSummaryByPair,
} from "../../store/marketStore";
import { fetchPairsSummary } from "../../services/api";

interface Props {
  loading: boolean;
  pairs: BondPair[];
}

const BondsTable = ({ loading, pairs }: Props) => {
  const setSummaries = useMarketStore((s) => s.setSummaries);

  useEffect(() => {
    if (pairs.length === 0) return;
    fetchPairsSummary()
      .then(setSummaries)
      .catch(() => {});
  }, [pairs.length, setSummaries]);

  return (
    <div className="overflow-hidden">
      <div className="overflow-x-auto">
        <div className="w-full text-sm">
          <div className="grid grid-cols-6 gap-1">
            <div className="card rounded-t-lg" />
            <div className="card text-center py-1 text-muted font-medium text-xs uppercase tracking-wider rounded-t-lg">
              Una Semana
            </div>
            <div className="card text-center py-1 text-muted font-medium text-xs uppercase tracking-wider rounded-t-lg">
              Dos Semanas
            </div>
            <div className="card text-center py-1 text-muted font-medium text-xs uppercase tracking-wider rounded-t-lg">
              Un Mes
            </div>
            <div className="card rounded-t-lg" />
            <div className="card rounded-t-lg" />
          </div>
          <div className="grid grid-cols-6 gap-1">
            <div className="grid grid-cols-2 items-center bg-surface-1/40">
              <div className="text-center py-1 px-1 text-muted font-medium">
                Ratios
              </div>
              <div className="text-center py-1 px-1 items-center text-muted font-medium">
                Ultimo Ratio
              </div>
            </div>
            <div className="grid grid-cols-2 items-center bg-surface-1/40">
              <div className="text-center py-1 px-1 text-muted font-medium">
                Promedio
              </div>
              <div className="text-center py-1 px-1 text-muted font-medium">
                Diferencia
              </div>
            </div>
            <div className="grid grid-cols-2 items-center bg-surface-1/40">
              <div className="text-center py-1 px-1 text-muted font-medium">
                Promedio
              </div>
              <div className="text-center py-1 px-1 text-muted font-medium">
                Diferencia
              </div>
            </div>
            <div className="grid grid-cols-2 items-center bg-surface-1/40">
              <div className="text-center py-1 px-1 text-muted font-medium">
                Promedio
              </div>
              <div className="text-center py-1 px-1 text-muted font-medium">
                Diferencia
              </div>
            </div>
            <div className="grid grid-cols-2 items-center bg-surface-1/40">
              <div className="text-center py-1 px-1 text-muted font-medium">
                Minimo Mensual
              </div>
              <div className="text-center py-1 px-1 text-muted font-medium">
                Diferencia
              </div>
            </div>
            <div className="grid grid-cols-2 items-center bg-surface-1/40">
              <div className="text-center py-1 px-1 text-muted font-medium">
                Maximo Mensual
              </div>
              <div className="text-center py-1 px-1 text-muted font-medium">
                Diferencia
              </div>
            </div>
          </div>
          {loading ? (
            <div className="py-12 text-center text-muted">
              <Activity className="w-5 h-5 animate-spin mx-auto mb-2" />
              Cargando datos...
            </div>
          ) : pairs.length === 0 ? (
            <div className="py-12 text-center text-muted">
              No hay pares configurados
            </div>
          ) : (
            pairs.map((pair) => <PairRow key={pair.id} pair={pair} />)
          )}
        </div>
      </div>
    </div>
  );
};

interface PairRowProps {
  pair: BondPair;
}

const PairRow = ({ pair }: PairRowProps) => {
  const live = useMarketStore(selectLiveByPair(pair.id));
  const summary = useMarketStore(selectSummaryByPair(pair.id));
  const isSelected = useMarketStore((s) => s.selectedPairId === pair.id);
  const setSelectedPairId = useMarketStore((s) => s.setSelectedPairId);

  const currentRatio = live?.currentRatio;
  const prevRatioRef = useRef<number | undefined>(undefined);
  const [flash, setFlash] = useState<{ dir: "up" | "down"; tick: number } | null>(
    null,
  );
  const tickRef = useRef(0);

  useEffect(() => {
    const prev = prevRatioRef.current;
    if (
      typeof currentRatio === "number" &&
      typeof prev === "number" &&
      currentRatio !== prev
    ) {
      tickRef.current += 1;
      setFlash({
        dir: currentRatio > prev ? "up" : "down",
        tick: tickRef.current,
      });
    }
    prevRatioRef.current = currentRatio;
  }, [currentRatio]);

  return (
    <div className="grid grid-cols-6 gap-1">
      <div
        onClick={() => setSelectedPairId(pair.id)}
        className={clsx(
          "card p-2 grid grid-cols-2 border-b border-surface-3/20 hover:bg-surface-2/50 transition-colors cursor-pointer",
          isSelected
            ? "bg-accent-blue/10 ring-1 ring-accent-blue/40"
            : "bg-surface-1/40",
        )}
      >
        <div className="flex items-center justify-center font-semibold text-center text-base font-mono">
          {pair.name}
        </div>
        <div
          key={flash?.tick ?? "initial"}
          className={clsx(
            "flex items-center justify-end text-white text-lg text-bold text-right rounded px-1",
            flash?.dir === "up" && "animate-flash-green",
            flash?.dir === "down" && "animate-flash-red",
          )}
        >
          {currentRatio?.toFixed(5)}
        </div>
      </div>

      <RefCell value={summary?.avg1w} current={currentRatio} />
      <RefCell value={summary?.avg2w} current={currentRatio} />
      <RefCell value={summary?.avg1m} current={currentRatio} />
      <RefCell value={summary?.min1m} current={currentRatio} />
      <RefCell value={summary?.max1m} current={currentRatio} />
    </div>
  );
};

interface RefCellProps {
  value: number | null | undefined;
  current: number | undefined;
}

const DIFF_CAP_PCT = 2;

const getDiffColor = (diff: number | null): string | undefined => {
  if (diff === null || diff === 0) return undefined;
  const intensity = Math.min(Math.abs(diff) / DIFF_CAP_PCT, 1);
  const hue = diff < 0 ? 142 : 0;
  const saturation = 20 + intensity * 70;
  const lightness = 60 - intensity * 5;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
};

const RefCell = ({ value, current }: RefCellProps) => {
  const hasValue = typeof value === "number" && Number.isFinite(value);
  const diff =
    hasValue && typeof current === "number" && value !== 0
      ? ((current - value) / value) * 100
      : null;

  const color = getDiffColor(diff);

  return (
    <div className="card p-2 grid grid-cols-2 items-center border-b border-surface-3/20 bg-surface-1/40">
      <div className="text-right pr-2 font-mono text-white text-base">
        {hasValue ? value.toFixed(5) : "—"}
      </div>
      <div
        className={clsx(
          "text-right font-mono text-base",
          diff === null && "text-muted",
        )}
        style={color ? { color } : undefined}
      >
        {diff === null
          ? "—"
          : `${diff >= 0 ? "+" : ""}${diff.toFixed(2)}%`}
      </div>
    </div>
  );
};

export default BondsTable;
