import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  createChart,
  createSeriesMarkers,
  ColorType,
  LineStyle,
  AreaSeries,
  LineSeries,
  CandlestickSeries,
  type AreaData,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineData,
  type Time,
  type SeriesMarker,
  type UTCTimestamp,
  type WhitespaceData,
} from "lightweight-charts";
import { useMarketStore } from "../../store/marketStore";
import { fetchPairCandles, fetchPairDailyBands } from "../../services/api";

type ChartMode = "candles" | "line";

const BUCKET_SECONDS = 5 * 60;
const SESSIONS_TO_SHOW = 21; // sesión actual + 20 anteriores
// Calendario, alcanza para 21+ ruedas hábiles + el warmup necesario para que
// la SMA200 (≈ 200 / 74 ≈ 2.7 ruedas regulares) llegue a las primeras velas
// visibles con valor calculado.
const HISTORY_LOOKBACK_DAYS = 35;
// Cantidad de deltas que promedia la fórmula de bandas (ver el handler de
// /api/pairs/:id/daily/bands para la fórmula completa). Cada delta consume
// 2 ruedas, así que la primera fila con banda válida necesita BANDS_WINDOW+1
// = 17 ruedas previas con datos.
const BANDS_WINDOW = 16;
// Calendario, alcanza para 17+ ruedas hábiles para las bandas + 21 ruedas
// hábiles que necesitamos para el promedio mensual.
const BANDS_DAYS = 50;
const SMA_PERIOD = 200;
const BB_STD_DEV = 2;
// Cantidad de ruedas que promediamos para la línea horizontal "promedio mes".
const MONTH_AVG_SESSIONS = 21;

// Fase 'regular' del backend: la rueda BYMA (10:30-17:00 ART) menos
// warmup/cooldown (default 10 min cada uno) ⇒ 10:40-16:50 ART.
// Mantener en sincronía con SESSION_WARMUP_MINUTES / SESSION_COOLDOWN_MINUTES
// del backend (ver packages/backend/src/config/index.ts).
const SESSION_WARMUP_MINUTES = 10;
const SESSION_COOLDOWN_MINUTES = 10;

// Color de fondo del chart — debe coincidir con `surface-0` del Tailwind
// para que el truco de "cover" del área inferior tape lo de abajo sin que
// se note (queda visible sólo la franja entre upper y lower).
const CHART_BG_COLOR = "rgba(0,0,0,0)";
const BAND_FILL_COLOR = "rgba(168, 85, 247, 0.18)";
const BAND_LINE_COLOR = "rgba(168, 85, 247, 0.85)";

// BYMA: rueda 10:30 a 17:00 ART (UTC-3, sin DST)
const SESSION_OPEN_UTC_H = 13;
const SESSION_OPEN_UTC_M = 30;
const SESSION_CLOSE_UTC_H = 20;
const SESSION_CLOSE_UTC_M = 0;
const SESSION_DURATION_SEC =
  (SESSION_CLOSE_UTC_H - SESSION_OPEN_UTC_H) * 3600 +
  (SESSION_CLOSE_UTC_M - SESSION_OPEN_UTC_M) * 60;
const BUCKETS_PER_SESSION = SESSION_DURATION_SEC / BUCKET_SECONDS; // 78

// Anchor arbitrario para el eje "lógico". El chartTime no representa un
// instante real — es un índice secuencial empacado en un UTCTimestamp para
// que lightweight-charts lo acepte. El mapeo a tiempo real se mantiene aparte.
const CHART_TIME_ANCHOR = Math.floor(Date.UTC(2020, 0, 1) / 1000);

interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
}

interface Slot {
  chartTime: UTCTimestamp; // tiempo lógico (índice secuencial)
  realStart: number; // segundos UTC del inicio del bucket real
  candle?: Candle;
}

const floorToBucket = (tsSec: number) =>
  Math.floor(tsSec / BUCKET_SECONDS) * BUCKET_SECONDS;

const sessionOpenUtcSec = (refMs: number): number => {
  // Día calendario en ART (UTC-3) → primer bucket (10:30 ART = 13:30 UTC).
  const art = new Date(refMs - 3 * 3600 * 1000);
  return (
    Date.UTC(
      art.getUTCFullYear(),
      art.getUTCMonth(),
      art.getUTCDate(),
      SESSION_OPEN_UTC_H,
      SESSION_OPEN_UTC_M,
    ) / 1000
  );
};

const formatArtHHMM = (realSec: number): string => {
  const art = new Date((realSec - 3 * 3600) * 1000);
  const hh = String(art.getUTCHours()).padStart(2, "0");
  const mm = String(art.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
};

const formatArtDateTime = (realSec: number): string => {
  const art = new Date((realSec - 3 * 3600) * 1000);
  const y = art.getUTCFullYear();
  const m = String(art.getUTCMonth() + 1).padStart(2, "0");
  const d = String(art.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d} ${formatArtHHMM(realSec)}`;
};

interface HistoricalCandle extends Candle {
  realStart: number;
}

/**
 * Construye la lista ordenada de slots a partir de las velas históricas
 * (cualquier número de sesiones pasadas) más el esqueleto de la sesión actual
 * (10:30 a 17:00 ART) con whitespace en los buckets sin datos.
 *
 * Cada slot recibe un chartTime secuencial: chartTime[i] = anchor + i * 5m.
 * Esto comprime visualmente el eje (sin huecos nocturnos / fin de semana).
 */
function buildSlots(historical: HistoricalCandle[]): {
  slots: Slot[];
  byBucket: Map<number, number>; // realStart → índice del slot
} {
  const fromHistory = new Map<number, Candle>();
  for (const c of historical) {
    fromHistory.set(c.realStart, {
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    });
  }

  // Esqueleto de la rueda actual: todos los buckets 10:30..16:55. Sólo
  // pre-allocamos si hoy es día hábil (Lun-Vie) en ART; en finde no tiene
  // sentido mostrar un bloque vacío al final.
  const artNow = new Date(Date.now() - 3 * 3600 * 1000);
  const artWeekday = artNow.getUTCDay(); // 0=Dom, 6=Sáb
  const isTradingDay = artWeekday >= 1 && artWeekday <= 5;

  const todayBuckets: number[] = [];
  if (isTradingDay) {
    const todaySessionStart = sessionOpenUtcSec(Date.now());
    for (let i = 0; i < BUCKETS_PER_SESSION; i++) {
      todayBuckets.push(todaySessionStart + i * BUCKET_SECONDS);
    }
  }

  const allBuckets = Array.from(
    new Set<number>([...fromHistory.keys(), ...todayBuckets]),
  ).sort((a, b) => a - b);

  const slots: Slot[] = [];
  const byBucket = new Map<number, number>();

  for (let i = 0; i < allBuckets.length; i++) {
    const realStart = allBuckets[i];
    slots.push({
      chartTime: (CHART_TIME_ANCHOR + i * BUCKET_SECONDS) as UTCTimestamp,
      realStart,
      candle: fromHistory.get(realStart),
    });
    byBucket.set(realStart, i);
  }

  return { slots, byBucket };
}

/**
 * Devuelve la fecha "YYYY-MM-DD" en ART (UTC-3, sin DST) de un slot.
 * Se usa para mapear cada bucket a la rueda a la que pertenece.
 */
function slotDateKey(realStart: number): string {
  const art = new Date((realStart - 3 * 3600) * 1000);
  const y = art.getUTCFullYear();
  const m = String(art.getUTCMonth() + 1).padStart(2, "0");
  const d = String(art.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Markers en cada apertura de rueda (10:30 ART) para que la transición
 * entre sesiones sea visible en el chart, ya que el eje X está comprimido
 * (sin huecos nocturnos / fin de semana).
 */
function buildSessionMarkers(slots: Slot[]): SeriesMarker<UTCTimestamp>[] {
  const sessionOpenSecOfDay =
    SESSION_OPEN_UTC_H * 3600 + SESSION_OPEN_UTC_M * 60;
  const markers: SeriesMarker<UTCTimestamp>[] = [];
  for (const s of slots) {
    const utcSecOfDay = ((s.realStart % 86400) + 86400) % 86400;
    if (utcSecOfDay !== sessionOpenSecOfDay) continue;
    const art = new Date((s.realStart - 3 * 3600) * 1000);
    const dd = String(art.getUTCDate()).padStart(2, "0");
    const mm = String(art.getUTCMonth() + 1).padStart(2, "0");
    markers.push({
      time: s.chartTime,
      position: "belowBar",
      color: "#3b82f6",
      shape: "arrowUp",
      text: `${dd}/${mm}`,
    });
  }
  return markers;
}

/**
 * `true` si el bucket cae dentro de la fase 'regular' de la rueda
 * (10:30 + warmup) a (17:00 - cooldown) en ART. Sólo estas velas se usan
 * para SMA y Bollinger Bands.
 */
function isRegularSession(realStart: number): boolean {
  const utcSecOfDay = ((realStart % 86400) + 86400) % 86400;
  const regularOpenSec =
    SESSION_OPEN_UTC_H * 3600 +
    SESSION_OPEN_UTC_M * 60 +
    SESSION_WARMUP_MINUTES * 60;
  const regularCloseSec =
    SESSION_CLOSE_UTC_H * 3600 +
    SESSION_CLOSE_UTC_M * 60 -
    SESSION_COOLDOWN_MINUTES * 60;
  return utcSecOfDay >= regularOpenSec && utcSecOfDay < regularCloseSec;
}

/**
 * SMA + Bollinger Bands (±k·σ) sobre los `close` de las velas regulares.
 * Devuelve Maps indexados por posición del slot para alinear con el chartTime.
 * Las velas fuera de la fase 'regular' (warmup/cooldown) no entran en la
 * ventana — esto matchea cómo el backend computa `avgClose`.
 */
function computeSMAandBB(
  slots: Slot[],
  period: number,
  stdDev: number,
): {
  sma: Map<number, number>;
  upperBB: Map<number, number>;
  lowerBB: Map<number, number>;
} {
  const sma = new Map<number, number>();
  const upperBB = new Map<number, number>();
  const lowerBB = new Map<number, number>();
  const closes: number[] = [];
  // Mantenemos en paralelo los índices de slot que aportaron cada close para
  // poder mapear la SMA/BB de vuelta a la posición correcta del chart.
  const slotIdx: number[] = [];

  for (let i = 0; i < slots.length; i++) {
    const c = slots[i].candle;
    if (!c) continue;
    if (!isRegularSession(slots[i].realStart)) continue;
    closes.push(c.close);
    slotIdx.push(i);
    if (closes.length < period) continue;

    let sum = 0;
    for (let k = closes.length - period; k < closes.length; k++)
      sum += closes[k];
    const mean = sum / period;

    let sqSum = 0;
    for (let k = closes.length - period; k < closes.length; k++) {
      const diff = closes[k] - mean;
      sqSum += diff * diff;
    }
    const sigma = Math.sqrt(sqSum / period);

    sma.set(i, mean);
    upperBB.set(i, mean + stdDev * sigma);
    lowerBB.set(i, mean - stdDev * sigma);
  }

  return { sma, upperBB, lowerBB };
}

interface RatioChartProps {
  // Si se pasa, el chart usa este pairId en lugar del seleccionado en el store.
  // Permite renderizar varios charts independientes (ver MultiChartsView).
  pairId?: string;
  // Altura del chart en px. Default 360 (preserva el uso original en Dashboard).
  height?: number;
}

type PromColors = { promant: string; prommonth: string; SMA: string };

const RatioChart = ({
  pairId: pairIdProp,
  height = 500,
}: RatioChartProps = {}) => {
  const storeSelectedPairId = useMarketStore((s) => s.selectedPairId);
  const selectedPairId = pairIdProp ?? storeSelectedPairId;
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

  const [mode, setMode] = useState<ChartMode>("line");

  const promColors: PromColors = {
    promant: "#02CF28",
    prommonth: "#F20202",
    SMA: "#f97316",
  };

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  // Truco para sombrear sólo la franja entre upper y lower:
  //  - upperBandAreaRef: área semi-transparente que llena DESDE la línea
  //    superior hacia abajo hasta el borde inferior del price scale.
  //  - lowerBandCoverRef: área OPACA con el color de fondo del chart, llena
  //    desde la línea inferior hacia abajo y "tapa" la parte de la upper area
  //    que sobresale por debajo de la lower line. Resultado: sólo la franja
  //    entre las dos líneas queda coloreada. Las velas/SMAs se agregan
  //    después y quedan por encima.
  const upperBandAreaRef = useRef<ISeriesApi<"Area"> | null>(null);
  const lowerBandCoverRef = useRef<ISeriesApi<"Area"> | null>(null);
  const smaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbUpperSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbLowerSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const seriesMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  const slotsRef = useRef<Slot[]>([]);
  const byBucketRef = useRef<Map<number, number>>(new Map());
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const avgPriceLinesRef = useRef<IPriceLine[]>([]);
  const currentPairIdRef = useRef<string | null>(null);
  // Banda diaria por fecha local ART ("YYYY-MM-DD" → upper/lower).
  const dailyBandsRef = useRef<Map<string, { upper: number; lower: number }>>(
    new Map(),
  );
  // Promedios de cierre regular por rueda — usados para las líneas
  // horizontales (rueda anterior / promedio mes).
  const [dailyAvgs, setDailyAvgs] = useState<{
    prevDay: number | null;
    month: number | null;
  }>({ prevDay: null, month: null });

  // Re-pinta toda la serie + bandas a partir del estado actual de los slots.
  const redraw = () => {
    const slots = slotsRef.current;
    if (slots.length === 0) {
      candleSeriesRef.current?.setData([]);
      lineSeriesRef.current?.setData([]);
      upperBandAreaRef.current?.setData([]);
      lowerBandCoverRef.current?.setData([]);
      smaSeriesRef.current?.setData([]);
      bbUpperSeriesRef.current?.setData([]);
      bbLowerSeriesRef.current?.setData([]);
      return;
    }

    if (mode === "candles" && candleSeriesRef.current) {
      const data: (CandlestickData | WhitespaceData)[] = slots.map((s) =>
        s.candle
          ? {
              time: s.chartTime,
              open: s.candle.open,
              high: s.candle.high,
              low: s.candle.low,
              close: s.candle.close,
            }
          : { time: s.chartTime },
      );
      candleSeriesRef.current.setData(data);
    } else if (mode === "line" && lineSeriesRef.current) {
      const data: (LineData | WhitespaceData)[] = slots.map((s) =>
        s.candle
          ? { time: s.chartTime, value: s.candle.close }
          : { time: s.chartTime },
      );
      lineSeriesRef.current.setData(data);
    }

    // Bandas diarias: cada slot busca la banda de su rueda (ART date).
    const bands = dailyBandsRef.current;
    const upperData: (AreaData | WhitespaceData)[] = slots.map((s) => {
      const b = bands.get(slotDateKey(s.realStart));
      return b ? { time: s.chartTime, value: b.upper } : { time: s.chartTime };
    });
    const lowerData: (AreaData | WhitespaceData)[] = slots.map((s) => {
      const b = bands.get(slotDateKey(s.realStart));
      return b ? { time: s.chartTime, value: b.lower } : { time: s.chartTime };
    });
    //upperBandAreaRef.current?.setData(upperData); //ACCCCCCCCCCCCCCCCCCCCCCCCAAAAAAAAAAAAAAAAAAAAA
    //lowerBandCoverRef.current?.setData(lowerData);

    // SMA 200 + Bollinger Bands (sólo velas regulares, ver computeSMAandBB).
    const { sma, upperBB, lowerBB } = computeSMAandBB(
      slots,
      SMA_PERIOD,
      BB_STD_DEV,
    );
    const toLineData = (
      values: Map<number, number>,
    ): (LineData | WhitespaceData)[] =>
      slots.map((s, i) => {
        const v = values.get(i);
        return v !== undefined
          ? { time: s.chartTime, value: v }
          : { time: s.chartTime };
      });
    smaSeriesRef.current?.setData(toLineData(sma));
    bbUpperSeriesRef.current?.setData(toLineData(upperBB));
    bbLowerSeriesRef.current?.setData(toLineData(lowerBB));

    // Markers de inicio de rueda en la serie activa.
    const markers = buildSessionMarkers(slots);
    const mainSeries =
      mode === "candles" ? candleSeriesRef.current : lineSeriesRef.current;
    seriesMarkersRef.current?.detach();
    seriesMarkersRef.current = mainSeries
      ? createSeriesMarkers(mainSeries, markers)
      : null;
  };

  // Crear chart una sola vez
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        // El truco del cover (área inferior opaca con el color de fondo)
        // requiere un fondo SÓLIDO; con `transparent` se ve a través.
        background: { type: ColorType.Solid, color: CHART_BG_COLOR },
        textColor: "#94a3b8",
        fontFamily: "JetBrains Mono, monospace",
      },
      grid: {
        vertLines: { color: "rgba(36, 48, 68, 0.4)", style: LineStyle.Dotted },
        horzLines: { color: "rgba(36, 48, 68, 0.4)", style: LineStyle.Dotted },
      },
      rightPriceScale: { borderColor: "rgba(36, 48, 68, 0.6)" },
      localization: {
        // Crosshair / tooltip muestra fecha + hora ART real (no la lógica)
        timeFormatter: (chartTime: UTCTimestamp) => {
          const idx = (Number(chartTime) - CHART_TIME_ANCHOR) / BUCKET_SECONDS;
          const slot = slotsRef.current[idx];
          return slot ? formatArtDateTime(slot.realStart) : "";
        },
      },
      timeScale: {
        borderColor: "rgba(36, 48, 68, 0.6)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 2,
        tickMarkFormatter: (chartTime: UTCTimestamp) => {
          const idx = (Number(chartTime) - CHART_TIME_ANCHOR) / BUCKET_SECONDS;
          const slot = slotsRef.current[idx];
          if (!slot) return "";
          // Si es el primer bucket de su rueda (10:30 ART = 13:30 UTC)
          // mostramos la fecha como marcador de inicio de sesión.
          const utcSecOfDay = ((slot.realStart % 86400) + 86400) % 86400;
          const sessionOpenUtcSecOfDay =
            SESSION_OPEN_UTC_H * 3600 + SESSION_OPEN_UTC_M * 60;
          if (utcSecOfDay === sessionOpenUtcSecOfDay) {
            const art = new Date((slot.realStart - 3 * 3600) * 1000);
            const dd = String(art.getUTCDate()).padStart(2, "0");
            const mm = String(art.getUTCMonth() + 1).padStart(2, "0");
            return `${dd}/${mm}`;
          }
          return formatArtHHMM(slot.realStart);
        },
      },
      crosshair: {
        vertLine: { color: "#3b82f6", width: 1, style: LineStyle.Dashed },
        horzLine: { color: "#3b82f6", width: 1, style: LineStyle.Dashed },
      },
      width: containerRef.current.clientWidth,
      height,
    });

    chartRef.current = chart;

    // Bandas diarias (avg high/low de las últimas N ruedas).
    // 1° upper area: gradiente plano que llena de la línea para abajo.
    // 2° lower cover: área OPACA con el color de fondo del chart, llena
    //    desde la línea inferior hacia abajo y tapa el sobrante de la
    //    upper area, dejando coloreada sólo la franja entre ambas.
    upperBandAreaRef.current = chart.addSeries(AreaSeries, {
      topColor: BAND_FILL_COLOR,
      bottomColor: BAND_FILL_COLOR,
      lineColor: BAND_LINE_COLOR,
      lineWidth: 1,
      priceFormat: { type: "price", precision: 5, minMove: 0.00001 },
      lastValueVisible: true,
      priceLineVisible: false,
      title: `Banda sup ${BANDS_WINDOW}d`,
    });
    lowerBandCoverRef.current = chart.addSeries(AreaSeries, {
      topColor: CHART_BG_COLOR,
      bottomColor: CHART_BG_COLOR,
      lineColor: BAND_LINE_COLOR,
      lineWidth: 1,
      priceFormat: { type: "price", precision: 5, minMove: 0.00001 },
      lastValueVisible: true,
      priceLineVisible: false,
      title: `Banda inf ${BANDS_WINDOW}d`,
    });

    // SMA200 + Bollinger Bands (±BB_STD_DEV·σ) sobre los closes regulares.
    smaSeriesRef.current = chart.addSeries(LineSeries, {
      color: "#f97316",
      lineWidth: 2,
      priceFormat: { type: "price", precision: 5, minMove: 0.00001 },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    bbUpperSeriesRef.current = chart.addSeries(LineSeries, {
      color: "#FF0000",
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      priceFormat: { type: "price", precision: 5, minMove: 0.00001 },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    bbLowerSeriesRef.current = chart.addSeries(LineSeries, {
      color: "#FF0000",
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      priceFormat: { type: "price", precision: 5, minMove: 0.00001 },
      lastValueVisible: false,
      priceLineVisible: false,
    });

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
      upperBandAreaRef.current = null;
      lowerBandCoverRef.current = null;
      smaSeriesRef.current = null;
      bbUpperSeriesRef.current = null;
      bbLowerSeriesRef.current = null;
    };
  }, []);

  // Re-aplicar altura cuando cambia el prop (MultiCharts redimensiona dinámicamente)
  useEffect(() => {
    chartRef.current?.applyOptions({ height });
  }, [height]);

  // Intercambiar serie principal según el modo (vela/línea)
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
      candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
        upColor: "#22c55e",
        downColor: "#ef4444",
        borderUpColor: "#22c55e",
        borderDownColor: "#ef4444",
        wickUpColor: "#22c55e",
        wickDownColor: "#ef4444",
        priceFormat: { type: "price", precision: 5, minMove: 0.00001 },
      });
    } else {
      lineSeriesRef.current = chart.addSeries(LineSeries, {
        color: "#06b6d4",
        lineWidth: 2,
        priceFormat: { type: "price", precision: 5, minMove: 0.00001 },
      });
    }

    redraw();
  }, [mode]);

  // Pintar alertas configuradas como líneas horizontales sobre la serie.
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
        title: `${arrow}`,
      });
      priceLinesRef.current.push(pl);
    }
  }, [pairAlertConfigs, mode]);

  // Líneas horizontales: promedio de la rueda anterior y promedio mes.
  useEffect(() => {
    const series =
      mode === "candles" ? candleSeriesRef.current : lineSeriesRef.current;
    if (!series) return;

    for (const pl of avgPriceLinesRef.current) {
      series.removePriceLine(pl);
    }
    avgPriceLinesRef.current = [];

    if (dailyAvgs.prevDay !== null) {
      avgPriceLinesRef.current.push(
        series.createPriceLine({
          price: dailyAvgs.prevDay,
          color: promColors.promant,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          //title: `Prom. ant. ${dailyAvgs.prevDay.toFixed(5)}`,
        }),
      );
    }
    if (dailyAvgs.month !== null) {
      avgPriceLinesRef.current.push(
        series.createPriceLine({
          price: dailyAvgs.month,
          color: promColors.prommonth,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          //title: `Prom. ${MONTH_AVG_SESSIONS}r ${dailyAvgs.month.toFixed(5)}`,
        }),
      );
    }
  }, [dailyAvgs, mode]);

  // Cambiar de par: limpiar buffer y recargar histórico (21 ruedas + warmup).
  useEffect(() => {
    if (currentPairIdRef.current === selectedPairId) return;
    currentPairIdRef.current = selectedPairId;
    slotsRef.current = [];
    byBucketRef.current = new Map();
    dailyBandsRef.current = new Map();
    setDailyAvgs({ prevDay: null, month: null });
    redraw();

    if (!selectedPairId) return;

    const pairIdAtFetchStart = selectedPairId;
    const now = Date.now();
    const fromMs = now - HISTORY_LOOKBACK_DAYS * 24 * 3600 * 1000;
    const toMs = now + 24 * 3600 * 1000; // un día de buffer
    const fromIso = new Date(fromMs).toISOString();
    const toIso = new Date(toMs).toISOString();
    const limit = SESSIONS_TO_SHOW * BUCKETS_PER_SESSION + 50;

    Promise.all([
      fetchPairCandles(pairIdAtFetchStart, {
        timeframe: "5m",
        from: fromIso,
        to: toIso,
        limit,
      }),
      fetchPairDailyBands(pairIdAtFetchStart, {
        window: BANDS_WINDOW,
        days: BANDS_DAYS,
      }).catch((err) => {
        // Sin bandas el chart sigue siendo útil — sólo logueamos.
        console.error("Error cargando bandas diarias", err);
        return null;
      }),
    ])
      .then(([apiCandles, bandsResp]) => {
        if (currentPairIdRef.current !== pairIdAtFetchStart) return;

        // Bandas: indexar por fecha local ART.
        const bandsMap = new Map<string, { upper: number; lower: number }>();
        // avgClose por fecha (sólo ruedas con dato real, excluye la fila
        // sintética de hoy que viene con avgClose=null).
        const avgCloseByDate: Array<{ date: string; avgClose: number }> = [];
        if (bandsResp) {
          for (const row of bandsResp.series) {
            if (row.upperBand !== null && row.lowerBand !== null) {
              bandsMap.set(row.date, {
                upper: row.upperBand,
                lower: row.lowerBand,
              });
            }
            if (row.avgClose !== null) {
              avgCloseByDate.push({ date: row.date, avgClose: row.avgClose });
            }
          }
        }
        dailyBandsRef.current = bandsMap;

        // Línea horizontal "rueda anterior": avgClose de la última rueda
        // cerrada (excluye hoy si todavía está en curso).
        // "Promedio mes": promedio de las últimas MONTH_AVG_SESSIONS ruedas.
        const todayKey = new Date(Date.now() - 3 * 3600 * 1000)
          .toISOString()
          .slice(0, 10);
        const closedRows = avgCloseByDate.filter((r) => r.date < todayKey);
        const prevDay =
          closedRows.length > 0
            ? closedRows[closedRows.length - 1].avgClose
            : null;
        const monthSlice = closedRows.slice(-MONTH_AVG_SESSIONS);
        const month =
          monthSlice.length > 0
            ? monthSlice.reduce((acc, r) => acc + r.avgClose, 0) /
              monthSlice.length
            : null;
        setDailyAvgs({ prevDay, month });

        // Asc por openTime
        apiCandles.sort(
          (a, b) =>
            new Date(a.openTime).getTime() - new Date(b.openTime).getTime(),
        );

        const historical: HistoricalCandle[] = apiCandles.map((c) => ({
          realStart: Math.floor(new Date(c.openTime).getTime() / 1000),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }));

        const { slots, byBucket } = buildSlots(historical);
        slotsRef.current = slots;
        byBucketRef.current = byBucket;
        redraw();

        // Foco en las últimas SESSIONS_TO_SHOW ruedas (incluye la actual).
        // Iteramos hacia atrás contando fechas distintas porque los slots no
        // son densos respecto al calendario (sólo contienen buckets reales
        // + los de hoy), así que multiplicar por BUCKETS_PER_SESSION sería
        // una aproximación grosera.
        const chart = chartRef.current;
        if (chart && slots.length > 0) {
          const lastIdx = slots.length - 1;
          const seenDates = new Set<string>();
          let fromIdx = 0;
          for (let i = lastIdx; i >= 0; i--) {
            seenDates.add(slotDateKey(slots[i].realStart));
            if (seenDates.size > SESSIONS_TO_SHOW) {
              fromIdx = i + 1;
              break;
            }
          }
          chart.timeScale().setVisibleLogicalRange({
            from: fromIdx,
            to: lastIdx + 1,
          });
        }
      })
      .catch((err) => {
        console.error("Error cargando velas del par", err);
      });
  }, [selectedPairId]);

  // Ingestar cada tick en el bucket de 5m correspondiente.
  useEffect(() => {
    if (!live || !selectedPairId) return;
    if (live.pairId !== selectedPairId) return;
    if (!Number.isFinite(live.currentRatio)) return;

    const ts = Math.floor(new Date(live.timestamp).getTime() / 1000);
    const bucket = floorToBucket(ts);
    const idx = byBucketRef.current.get(bucket);
    if (idx === undefined) return; // tick fuera de la rueda dibujada

    const slot = slotsRef.current[idx];
    const price = live.currentRatio;
    if (!slot.candle) {
      slot.candle = { open: price, high: price, low: price, close: price };
    } else {
      if (price > slot.candle.high) slot.candle.high = price;
      if (price < slot.candle.low) slot.candle.low = price;
      slot.candle.close = price;
    }
    redraw();
  }, [live, selectedPairId, mode]);

  return (
    <div className="relative border border-surface-3/30 rounded-lg h-full">
      <div className="absolute flex flex-col p-1">
        <div className="flex flex-row">
          <div className="flex text-lg font-semibold font-mono items-center text-white py-1 pl-1 pr-4">
            {pair ? pair.name : "Seleccioná un par"}
          </div>
          <div className="flex items-center text-xs uppercase tracking-wider text-muted py-1 pr-4">
            Ratio · velas 5m · {SESSIONS_TO_SHOW}r · bandas {BANDS_WINDOW}d ·
            SMA{SMA_PERIOD} · BB ±{BB_STD_DEV}σ
          </div>
          <div className="flex items-center">
            {live && pair && (
              <div className="text-right font-mono pr-4">
                <div className="text-xs text-muted">Último</div>
                <div className="text-accent-cyan text-xl font-semibold">
                  {live.currentRatio?.toFixed(5)}
                </div>
              </div>
            )}
            <div className="flex rounded-md bg-surface-2/50 p-0.5 text-xs font-medium z-20">
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
        {pair && (
          <div className="flex flex-col gap-1 w-25 pl-1">
            <div
              className="text-xs w-full font-medium font-mono text-white p-1 rounded"
              style={{ backgroundColor: `${promColors.promant}` }}
            >
              Prom. ant.
            </div>
            <div
              className="text-xs w-full font-medium font-mono text-white p-1 rounded"
              style={{ backgroundColor: `${promColors.prommonth}` }}
            >
              Prom. {MONTH_AVG_SESSIONS}r
            </div>
            <div
              className="text-xs w-full font-medium font-mono text-white p-1 rounded"
              style={{ backgroundColor: `${promColors.SMA}` }}
            >
              SMA{SMA_PERIOD}
            </div>
          </div>
        )}
      </div>
      <div ref={containerRef} className="w-full h-full z-10" />
      {!selectedPairId && (
        <div className="text-center text-muted text-sm py-4">
          Tocá una fila en la tabla para ver su ratio en vivo.
        </div>
      )}
    </div>
  );
};

export default RatioChart;
