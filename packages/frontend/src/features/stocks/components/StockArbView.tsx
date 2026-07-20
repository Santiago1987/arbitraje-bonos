import { useEffect, useMemo } from "react";
import { TrendingUp } from "lucide-react";
import clsx from "clsx";
import {
  useStockArbStore,
  selectTasaCaucion,
  selectDiasCaucion,
  selectCostoCaucion,
} from "../store/stockArbStore";
import { selectIsConnected } from "../../bonds/store/marketStore";
import { useMarketStore } from "../../bonds/store/marketStore";
import {
  subscribeToStocks,
  unsubscribeFromStocks,
} from "../../bonds/services/wsClient";
import StockArbTable from "./StockArbTable";
import type { StockArbUpdate } from "@arbitraje/shared";

const TOP_N = 40;
const PAGE_SIZE = 20;

// Ordena por ganancia desc; sin dato (caución o alguna pata faltante) al final.
function sortByGanancia(rows: StockArbUpdate[]): StockArbUpdate[] {
  return [...rows].sort((a, b) => {
    if (a.ganancia == null && b.ganancia == null) return 0;
    if (a.ganancia == null) return 1;
    if (b.ganancia == null) return -1;
    return b.ganancia - a.ganancia;
  });
}

export default function StockArbView() {
  const rows = useStockArbStore((s) => s.rows);
  const tasaCaucion = useStockArbStore(selectTasaCaucion);
  const diasCaucion = useStockArbStore(selectDiasCaucion);
  const costoCaucion = useStockArbStore(selectCostoCaucion);
  const bymaConnected = useMarketStore(selectIsConnected);

  // Suscripción al canal "stocks" solo mientras esta vista está montada:
  // son ~350 tickers, no vale la pena recibirlos en el resto de la app.
  useEffect(() => {
    subscribeToStocks();
    return () => unsubscribeFromStocks();
  }, []);

  const [left, right] = useMemo(() => {
    const top = sortByGanancia(Object.values(rows)).slice(0, TOP_N);
    return [top.slice(0, PAGE_SIZE), top.slice(PAGE_SIZE, TOP_N)];
  }, [rows]);

  return (
    <div className="p-4 h-full overflow-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-accent-cyan" />
          Arbitraje Acciones CI vs 24hs
        </h2>

        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted">
            Caución:{" "}
            <span className="text-white font-mono">
              {tasaCaucion != null ? `${(tasaCaucion * 100).toFixed(2)}%` : "—"}
            </span>{" "}
            a{" "}
            <span className="text-white font-mono">
              {diasCaucion ?? "—"}
            </span>{" "}
            días (+{costoCaucion != null ? (costoCaucion * 100).toFixed(2) : "—"}%
            costo)
          </span>
          <span
            className={clsx(
              "badge",
              bymaConnected ? "badge-green" : "badge-red",
            )}
          >
            {bymaConnected ? "BYMA conectado" : "BYMA desconectado"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <StockArbTable rows={left} />
        <StockArbTable rows={right} />
      </div>
    </div>
  );
}
