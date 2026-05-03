import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { BondPair } from "@arbitraje/shared";
import {
  useMarketStore,
  selectLiveByPair,
  selectSummaryByPair,
} from "../../store/marketStore";
import RefCell from "./RefCell";

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
  const [flash, setFlash] = useState<{
    dir: "up" | "down";
    tick: number;
  } | null>(null);
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

      <RefCell value={summary?.avgPrev} current={currentRatio} />
      <RefCell value={summary?.avg1w} current={currentRatio} />
      <RefCell value={summary?.avg1m} current={currentRatio} />
      <RefCell value={summary?.min1m} current={currentRatio} />
      <RefCell value={summary?.max1m} current={currentRatio} />
    </div>
  );
};

export default PairRow;
