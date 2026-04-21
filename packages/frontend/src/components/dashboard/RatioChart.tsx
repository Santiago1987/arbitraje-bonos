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
  type WhitespaceData,
} from "lightweight-charts";
import { useMarketStore } from "../../store/marketStore";
import { fetchPairHistory } from "../../services/api";

type ChartMode = "candles" | "line";

const MINUTE = 60;

// BYMA: rueda de 10:30 a 17:00 ART (UTC-3, sin DST)
const SESSION_OPEN_UTC_H = 13;
const SESSION_OPEN_UTC_M = 30;
const SESSION_CLOSE_UTC_H = 20;
const SESSION_CLOSE_UTC_M = 0;

interface Candle {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
}

const floorToMinute = (ts: number) => Math.floor(ts / MINUTE) * MINUTE;

// Lightweight-charts muestra tiempos en UTC. Restamos 3 h para renderizar en ART.
const formatArtHHMM = (time: UTCTimestamp) => {
  const art = new Date(((time as number) - 3 * 3600) * 1000);
  const hh = String(art.getUTCHours()).padStart(2, "0");
  const mm = String(art.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
};

const getSessionRange = (refMs: number = Date.now()) => {
  // Día calendario en ART para anclar la rueda
  const art = new Date(refMs - 3 * 3600 * 1000);
  const y = art.getUTCFullYear();
  const m = art.getUTCMonth();
  const d = art.getUTCDate();
  const from = Date.UTC(y, m, d, SESSION_OPEN_UTC_H, SESSION_OPEN_UTC_M) / 1000;
  const to = Date.UTC(y, m, d, SESSION_CLOSE_UTC_H, SESSION_CLOSE_UTC_M) / 1000;
  return { from: from as UTCTimestamp, to: to as UTCTimestamp };
};

const buildWhitespace = (range: {
  from: UTCTimestamp;
  to: UTCTimestamp;
}): WhitespaceData[] => {
  const out: WhitespaceData[] = [];
  for (let t = range.from as number; t <= (range.to as number); t += MINUTE) {
    out.push({ time: t as UTCTimestamp });
  }
  return out;
};

const RatioChart = () => {
  const selectedPairId = useMarketStore((s) => s.selectedPairId);
  const pair = useMarketStore((s) =>
    s.pairs.find((p) => p.id === selectedPairId),
  );
  const live = useMarketStore((s) =>
    selectedPairId ? s.liveData[selectedPairId] : undefined,
  );
  const alertConfigs = useMarketStore((s) => s.alertConfigs);
  const pairAlertConfigs = useMemo(
    () =>
      alertConfigs.filter(
        (a) =>
          a.pairId === selectedPairId &&
          a.field === "ratio" &&
          a.status !== "disabled" &&
          Number.isFinite(a.threshold),
      ),
    [alertConfigs, selectedPairId],
  );

  const [mode, setMode] = useState<ChartMode>("candles");

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const candlesRef = useRef<Map<number, Candle>>(new Map());
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const sessionRangeRef = useRef(getSessionRange());
  const currentPairIdRef = useRef<string | null>(null);

  // Re-dibuja toda la serie desde el buffer (sobre el esqueleto de la rueda)
  const redraw = () => {
    const range = sessionRangeRef.current;
    const ws = buildWhitespace(range);
    const byTime = new Map<number, Candle>();
    for (const c of candlesRef.current.values())
      byTime.set(c.time as number, c);

    if (mode === "candles" && candleSeriesRef.current) {
      const data: (CandlestickData | WhitespaceData)[] = ws.map((w) => {
        const c = byTime.get(w.time as number);
        return c
          ? {
              time: c.time,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
            }
          : w;
      });
      candleSeriesRef.current.setData(data);
    } else if (mode === "line" && lineSeriesRef.current) {
      const data: (LineData | WhitespaceData)[] = ws.map((w) => {
        const c = byTime.get(w.time as number);
        return c ? { time: c.time, value: c.close } : w;
      });
      lineSeriesRef.current.setData(data);
    }
  };

  // Crear chart una sola vez
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#94a3b8",
        fontFamily: "JetBrains Mono, monospace",
      },
      grid: {
        vertLines: { color: "rgba(36, 48, 68, 0.4)", style: LineStyle.Dotted },
        horzLines: { color: "rgba(36, 48, 68, 0.4)", style: LineStyle.Dotted },
      },
      rightPriceScale: { borderColor: "rgba(36, 48, 68, 0.6)" },
      localization: {
        timeFormatter: (time: UTCTimestamp) => formatArtHHMM(time),
      },
      timeScale: {
        borderColor: "rgba(36, 48, 68, 0.6)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 2,
        tickMarkFormatter: (time: UTCTimestamp) => formatArtHHMM(time),
      },
      crosshair: {
        vertLine: { color: "#3b82f6", width: 1, style: LineStyle.Dashed },
        horzLine: { color: "#3b82f6", width: 1, style: LineStyle.Dashed },
      },
      width: containerRef.current.clientWidth,
      height: 360,
    });

    chartRef.current = chart;

    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
        });
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      lineSeriesRef.current = null;
    };
  }, []);

  // Intercambiar serie según el modo (vela/línea) y re-sembrar
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

    redraw();
    chart.timeScale().setVisibleRange(sessionRangeRef.current);
  }, [mode]);

  // Pintar alertas configuradas sobre el ratio como líneas horizontales
  // punteadas amarillas. Se re-sincroniza al cambiar de par, de modo de vista
  // (que recrea la serie) o al altas/bajas/ediciones de alertas.
  useEffect(() => {
    const series =
      mode === "candles" ? candleSeriesRef.current : lineSeriesRef.current;
    if (!series) return;

    for (const pl of priceLinesRef.current) {
      series.removePriceLine(pl);
    }
    priceLinesRef.current = [];

    for (const cfg of pairAlertConfigs) {
      const arrow =
        cfg.condition === "above" || cfg.condition === "cross_above"
          ? "▲"
          : "▼";
      const pl = series.createPriceLine({
        price: cfg.threshold,
        color: "#eab308",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: `${arrow} ${cfg.threshold.toFixed(5)}`,
      });
      priceLinesRef.current.push(pl);
    }
  }, [pairAlertConfigs, mode]);

  // Limpiar buffer, re-anclar la rueda y sembrar velas desde historial al
  // cambiar de par. Previene el flicker al recargar / cambiar de ratio.
  useEffect(() => {
    if (currentPairIdRef.current === selectedPairId) return;
    currentPairIdRef.current = selectedPairId;
    candlesRef.current.clear();
    sessionRangeRef.current = getSessionRange();
    redraw();
    chartRef.current?.timeScale().setVisibleRange(sessionRangeRef.current);

    if (!selectedPairId) return;

    const pairIdAtFetchStart = selectedPairId;
    const range = sessionRangeRef.current;
    const fromIso = new Date((range.from as number) * 1000).toISOString();
    const toIso = new Date((range.to as number) * 1000).toISOString();

    fetchPairHistory(pairIdAtFetchStart, fromIso, toIso, 10000)
      .then((snapshots) => {
        // Carrera: el usuario cambió de par antes de que volviera el fetch
        if (currentPairIdRef.current !== pairIdAtFetchStart) return;

        for (const snap of snapshots) {
          if (!Number.isFinite(snap.ratio)) continue;
          const ts = Math.floor(new Date(snap.timestamp).getTime() / 1000);
          const minute = floorToMinute(ts);
          const price = snap.ratio;
          const existing = candlesRef.current.get(minute);
          if (!existing) {
            candlesRef.current.set(minute, {
              time: minute as UTCTimestamp,
              open: price,
              high: price,
              low: price,
              close: price,
            });
          } else {
            existing.close = price;
            if (price > existing.high) existing.high = price;
            if (price < existing.low) existing.low = price;
          }
        }
        redraw();
      })
      .catch((err) => {
        console.error("Error cargando historial del par", err);
      });
  }, [selectedPairId]);

  // Ingestar cada tick en la vela de 1 minuto correspondiente
  useEffect(() => {
    if (!live || !selectedPairId) return;
    if (live.pairId !== selectedPairId) return;
    if (!Number.isFinite(live.currentRatio)) return;

    const ts = Math.floor(new Date(live.timestamp).getTime() / 1000);
    const minute = floorToMinute(ts);
    const price = live.currentRatio;

    const existing = candlesRef.current.get(minute);
    if (!existing) {
      candlesRef.current.set(minute, {
        time: minute as UTCTimestamp,
        open: price,
        high: price,
        low: price,
        close: price,
      });
    } else {
      existing.close = price;
      if (price > existing.high) existing.high = price;
      if (price < existing.low) existing.low = price;
    }

    // No se puede usar series.update() porque el whitespace de la rueda
    // extiende la "última hora" hasta las 17:00, y los ticks suelen caer
    // en un minuto anterior. Reescribimos el set entero (≤390 puntos).
    redraw();
  }, [live, selectedPairId, mode]);

  return (
    <div className="border border-surface-3/30 rounded-lg p-2 mt-2">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted">
            Ratio intradiario (velas 1m)
          </div>
          <div className="text-lg font-semibold font-mono text-white">
            {pair ? pair.name : "Seleccioná un par"}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {live && pair && (
            <div className="text-right font-mono">
              <div className="text-xs text-muted">Último</div>
              <div className="text-accent-cyan text-xl font-semibold">
                {live.currentRatio?.toFixed(5)}
              </div>
            </div>
          )}
          <div className="flex rounded-md bg-surface-2/50 p-0.5 text-xs font-medium">
            <button
              type="button"
              onClick={() => setMode("candles")}
              className={clsx(
                "px-3 py-1 rounded transition-colors",
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
                "px-3 py-1 rounded transition-colors",
                mode === "line"
                  ? "bg-accent-blue/20 text-white"
                  : "text-muted hover:text-white",
              )}
            >
              Línea
            </button>
          </div>
        </div>
      </div>
      <div ref={containerRef} className="w-full" />
      {!selectedPairId && (
        <div className="text-center text-muted text-sm py-4">
          Tocá una fila en la tabla para ver su ratio en vivo.
        </div>
      )}
    </div>
  );
};

export default RatioChart;
