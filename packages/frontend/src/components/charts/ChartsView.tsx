import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  createChart,
  ColorType,
  LineStyle,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LineData,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Bond } from "@arbitraje/shared";
import {
  fetchBondCandles,
  fetchRatioCandles,
  type CandleAPI,
} from "../../services/api";
import { BondAutocomplete } from "./BondAutocomplete";

type ChartMode = "candles" | "line";

const CHART_BG_COLOR = "#0a0e17";
const AVG_LINE_COLOR = "#ef4444";

// Formato YYYY-MM-DD en zona local — coincide con lo que devuelve y acepta
// `<input type="date">`.
const toDateInput = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// El backend emite openTime como midnight UTC del día local del mercado.
// Para filtrar "fechas inclusivas" comparamos contra los mismos anclajes
// UTC: from = midnight UTC, to = end-of-day UTC.
const dateToFromMs = (date: string): number =>
  new Date(`${date}T00:00:00.000Z`).getTime();
const dateToToMs = (date: string): number =>
  new Date(`${date}T23:59:59.999Z`).getTime();

const candleDateInput = (c: CandleAPI): string => {
  const d = new Date(c.openTime);
  // openTime ya es midnight UTC del día local — usamos UTC para extraer YMD.
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const toCandlestickData = (candles: CandleAPI[]): CandlestickData[] =>
  candles
    .map((c) => ({
      time: Math.floor(new Date(c.openTime).getTime() / 1000) as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }))
    .sort((a, b) => (a.time as number) - (b.time as number));

const toLineData = (candles: CandleAPI[]): LineData[] =>
  candles
    .map((c) => ({
      time: Math.floor(new Date(c.openTime).getTime() / 1000) as UTCTimestamp,
      value: c.close,
    }))
    .sort((a, b) => (a.time as number) - (b.time as number));

const ChartsView = () => {
  const [bondA, setBondA] = useState<Bond | null>(null);
  const [bondB, setBondB] = useState<Bond | null>(null);
  const [mode, setMode] = useState<ChartMode>("candles");
  const [candles, setCandles] = useState<CandleAPI[]>([]);
  // Si está vacío, el filtro inferior no aplica (se interpreta "desde el
  // primer dato"). Apenas llegan velas, lo seteamos al primer día disponible
  // para que el input refleje la ventana real.
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>(toDateInput(new Date()));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const avgPriceLineRef = useRef<IPriceLine | null>(null);

  // Velas dentro de la ventana [fromDate, toDate] inclusive.
  const visibleCandles = useMemo(() => {
    if (candles.length === 0) return candles;
    const fromMs = fromDate ? dateToFromMs(fromDate) : -Infinity;
    const toMs = toDate ? dateToToMs(toDate) : Infinity;
    return candles.filter((c) => {
      const t = new Date(c.openTime).getTime();
      return t >= fromMs && t <= toMs;
    });
  }, [candles, fromDate, toDate]);

  // Min/Max/Promedio para una lista de velas. Min/Max usan los extremos
  // intradiarios (low/high), promedio usa close. Devuelve null si está vacío.
  const computeStats = (
    list: CandleAPI[],
  ): {
    min: number;
    max: number;
    avg: number;
    minDate: string;
    maxDate: string;
  } | null => {
    if (list.length === 0) return null;
    let min = Infinity;
    let max = -Infinity;
    let minDate = "";
    let maxDate = "";
    let sumClose = 0;
    for (const c of list) {
      if (c.low < min) {
        min = c.low;
        minDate = candleDateInput(c);
      }
      if (c.high > max) {
        max = c.high;
        maxDate = candleDateInput(c);
      }
      sumClose += c.close;
    }
    return { min, max, avg: sumClose / list.length, minDate, maxDate };
  };

  const historicalStats = useMemo(() => computeStats(candles), [candles]);
  const windowStats = useMemo(() => computeStats(visibleCandles), [visibleCandles]);

  // El promedio de la ventana es lo que dibuja la línea roja del chart y
  // también lo que muestra el header.
  const average = windowStats?.avg ?? null;

  // Crear chart una sola vez. ResizeObserver mantiene el chart al tamaño
  // del contenedor (que es flex-1, así que ocupa el alto disponible).
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: CHART_BG_COLOR },
        textColor: "#94a3b8",
        fontFamily: "JetBrains Mono, monospace",
      },
      grid: {
        vertLines: { color: "rgba(36, 48, 68, 0.4)", style: LineStyle.Dotted },
        horzLines: { color: "rgba(36, 48, 68, 0.4)", style: LineStyle.Dotted },
      },
      rightPriceScale: { borderColor: "rgba(36, 48, 68, 0.6)" },
      timeScale: {
        borderColor: "rgba(36, 48, 68, 0.6)",
        timeVisible: false,
        secondsVisible: false,
        rightOffset: 4,
      },
      crosshair: {
        vertLine: { color: "#3b82f6", width: 1, style: LineStyle.Dashed },
        horzLine: { color: "#3b82f6", width: 1, style: LineStyle.Dashed },
      },
      width: el.clientWidth,
      height: el.clientHeight,
    });

    chartRef.current = chart;

    const ro = new ResizeObserver(() => {
      if (!chartRef.current) return;
      chartRef.current.applyOptions({
        width: el.clientWidth,
        height: el.clientHeight,
      });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      lineSeriesRef.current = null;
      avgPriceLineRef.current = null;
    };
  }, []);

  // Crea/recrea la serie correspondiente al modo activo. Sólo mantenemos UNA
  // serie viva por vez para evitar que el price scale se ajuste a ambas.
  // Removemos la serie anterior — su price line de promedio se va con ella,
  // por eso reseteamos el ref también.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (candleSeriesRef.current) {
      chart.removeSeries(candleSeriesRef.current);
      candleSeriesRef.current = null;
    }
    if (lineSeriesRef.current) {
      chart.removeSeries(lineSeriesRef.current);
      lineSeriesRef.current = null;
    }
    avgPriceLineRef.current = null;

    if (mode === "candles") {
      candleSeriesRef.current = chart.addCandlestickSeries({
        upColor: "#22c55e",
        downColor: "#ef4444",
        borderUpColor: "#22c55e",
        borderDownColor: "#ef4444",
        wickUpColor: "#22c55e",
        wickDownColor: "#ef4444",
        priceFormat: { type: "price", precision: 5, minMove: 0.00001 },
      });
    } else {
      lineSeriesRef.current = chart.addLineSeries({
        color: "#06b6d4",
        lineWidth: 2,
        priceFormat: { type: "price", precision: 5, minMove: 0.00001 },
      });
    }
  }, [mode]);

  // Carga de datos según bondA / bondB. La key del request es
  // (bondA.fullTicker, bondB.fullTicker) — un cambio cancela el anterior con
  // el flag `cancelled`. También se resetean las fechas para que el "desde"
  // se vuelva a auto-completar con el primer dato del nuevo histórico.
  useEffect(() => {
    if (!bondA) {
      setCandles([]);
      setFromDate("");
      setToDate(toDateInput(new Date()));
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setFromDate("");
    setToDate(toDateInput(new Date()));

    const promise = bondB
      ? fetchRatioCandles({
          tickerA: bondA.ticker,
          settlementA: bondA.settlement,
          tickerB: bondB.ticker,
          settlementB: bondB.settlement,
          limit: 2000,
        })
      : fetchBondCandles({
          ticker: bondA.ticker,
          settlement: bondA.settlement,
          limit: 2000,
        });

    promise
      .then((c) => {
        if (cancelled) return;
        setCandles(c);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Error cargando velas", err);
        setError(err instanceof Error ? err.message : "Error desconocido");
        setCandles([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [bondA, bondB]);

  // Auto-completar el input "desde" con el primer día del histórico cargado.
  // Sólo si el usuario aún no lo tocó (fromDate vacío).
  useEffect(() => {
    if (candles.length === 0) return;
    if (fromDate !== "") return;
    setFromDate(candleDateInput(candles[0]));
  }, [candles, fromDate]);

  // Pintar la serie activa con las velas visibles.
  useEffect(() => {
    if (mode === "candles") {
      candleSeriesRef.current?.setData(toCandlestickData(visibleCandles));
    } else {
      lineSeriesRef.current?.setData(toLineData(visibleCandles));
    }
    if (visibleCandles.length > 0) {
      chartRef.current?.timeScale().fitContent();
    }
  }, [visibleCandles, mode]);

  // Línea horizontal con el promedio de close en la ventana visible.
  // Se recrea cada vez que cambia el promedio o la serie (al cambiar de modo).
  useEffect(() => {
    const series =
      mode === "candles" ? candleSeriesRef.current : lineSeriesRef.current;
    if (!series) return;

    if (avgPriceLineRef.current) {
      try {
        series.removePriceLine(avgPriceLineRef.current);
      } catch {
        // si la serie fue destruida, la price line ya se fue con ella
      }
      avgPriceLineRef.current = null;
    }

    if (average == null) return;

    avgPriceLineRef.current = series.createPriceLine({
      price: average,
      color: AVG_LINE_COLOR,
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: `Prom`,
    });
  }, [average, mode]);

  const titleParts: string[] = [];
  if (bondA) titleParts.push(bondA.fullTicker);
  if (bondB) titleParts.push(bondB.fullTicker);
  const title =
    titleParts.length === 0
      ? "Seleccioná un activo"
      : titleParts.length === 1
        ? titleParts[0]
        : `${titleParts[0]} / ${titleParts[1]}`;

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      <div className="flex flex-wrap items-end gap-3 px-4 py-3 border-b border-surface-3/30 bg-surface-1">
        <BondAutocomplete
          label="Activo A"
          value={bondA}
          onChange={setBondA}
          excludeFullTicker={bondB?.fullTicker}
          placeholder="Ej: GD30, AL30…"
        />
        <BondAutocomplete
          label="Activo B (opcional)"
          value={bondB}
          onChange={setBondB}
          excludeFullTicker={bondA?.fullTicker}
          placeholder="Para graficar el ratio A/B"
        />
        <div className="shrink-0">
          <label className="block text-xs uppercase tracking-wider text-muted mb-1">
            Desde
          </label>
          <input
            type="date"
            value={fromDate}
            max={toDate || undefined}
            onChange={(e) => setFromDate(e.target.value)}
            style={{ colorScheme: "dark" }}
            className="px-3 py-2 rounded-lg bg-surface-2 border border-surface-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent-blue"
          />
        </div>
        <div className="shrink-0">
          <label className="block text-xs uppercase tracking-wider text-muted mb-1">
            Hasta
          </label>
          <input
            type="date"
            value={toDate}
            min={fromDate || undefined}
            onChange={(e) => setToDate(e.target.value)}
            style={{ colorScheme: "dark" }}
            className="px-3 py-2 rounded-lg bg-surface-2 border border-surface-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent-blue"
          />
        </div>
        <div className="flex-1 min-w-[180px] text-right">
          <div className="text-xs uppercase tracking-wider text-muted">
            {bondB ? "Ratio · diario" : "Precio · diario"}
            {average != null && (
              <span className="ml-2 normal-case tracking-normal text-accent-red">
                · prom {average.toFixed(5)}
              </span>
            )}
          </div>
          <div className="text-base font-semibold font-mono text-white truncate">
            {title}
          </div>
        </div>
        <div className="flex rounded-md bg-surface-2/50 p-0.5 text-xs font-medium">
          <button
            type="button"
            onClick={() => setMode("candles")}
            className={clsx(
              "px-3 py-1.5 rounded transition-colors",
              mode === "candles"
                ? "bg-accent-blue/20 text-white"
                : "text-muted hover:text-white",
            )}
          >
            Velas
          </button>
          <button
            type="button"
            onClick={() => setMode("line")}
            className={clsx(
              "px-3 py-1.5 rounded transition-colors",
              mode === "line"
                ? "bg-accent-blue/20 text-white"
                : "text-muted hover:text-white",
            )}
          >
            Línea
          </button>
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        <div ref={containerRef} className="absolute inset-0" />
        {!bondA && (
          <div className="absolute inset-0 flex items-center justify-center text-muted text-sm pointer-events-none">
            Seleccioná un activo para ver el gráfico.
          </div>
        )}
        {bondA && !loading && candles.length > 0 && visibleCandles.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-muted text-sm pointer-events-none">
            Sin datos en el rango seleccionado.
          </div>
        )}
        {bondA && !loading && candles.length === 0 && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-muted text-sm pointer-events-none">
            Sin datos disponibles para esta selección.
          </div>
        )}
        {loading && (
          <div className="absolute top-3 right-3 px-2 py-1 text-xs text-muted bg-surface-2/80 rounded-md">
            Cargando…
          </div>
        )}
        {error && (
          <div className="absolute top-3 right-3 px-2 py-1 text-xs text-accent-red bg-accent-red/10 border border-accent-red/30 rounded-md">
            {error}
          </div>
        )}
      </div>

      {historicalStats && (
        <StatsFooter historical={historicalStats} window={windowStats} />
      )}
    </div>
  );
};

interface PriceStats {
  min: number;
  max: number;
  avg: number;
  minDate: string;
  maxDate: string;
}

interface StatsFooterProps {
  historical: PriceStats;
  window: PriceStats | null;
}

const fmtPrice = (n: number) => n.toFixed(5);

const StatCell = ({
  label,
  value,
  date,
}: {
  label: string;
  value: string;
  date?: string;
}) => (
  <div className="min-w-0">
    <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
    <div className="font-mono text-sm text-white truncate">{value}</div>
    {date && (
      <div className="text-[10px] text-muted font-mono truncate">{date}</div>
    )}
  </div>
);

const StatsFooter = ({ historical, window: win }: StatsFooterProps) => {
  return (
    <div className="border-t border-surface-3/30 bg-surface-1 px-4 py-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted mb-2">
            Histórico completo
          </div>
          <div className="grid grid-cols-3 gap-3">
            <StatCell
              label="Mínimo"
              value={fmtPrice(historical.min)}
              date={historical.minDate}
            />
            <StatCell
              label="Máximo"
              value={fmtPrice(historical.max)}
              date={historical.maxDate}
            />
            <StatCell label="Promedio" value={fmtPrice(historical.avg)} />
          </div>
        </div>
        <div className="md:border-l md:border-surface-3/30 md:pl-4">
          <div className="text-xs uppercase tracking-wider text-muted mb-2">
            Ventana seleccionada
          </div>
          {win ? (
            <div className="grid grid-cols-3 gap-3">
              <StatCell
                label="Mínimo"
                value={fmtPrice(win.min)}
                date={win.minDate}
              />
              <StatCell
                label="Máximo"
                value={fmtPrice(win.max)}
                date={win.maxDate}
              />
              <StatCell label="Promedio" value={fmtPrice(win.avg)} />
            </div>
          ) : (
            <div className="text-sm text-muted">Sin datos en el rango.</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChartsView;
