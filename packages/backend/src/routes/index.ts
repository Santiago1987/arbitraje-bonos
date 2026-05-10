import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  BondModel,
  BondPairModel,
  PairSnapshotModel,
  PairDailyModel,
  AlertConfigModel,
} from "../models/index.js";
import { pairCalculatorService } from "../services/pair-calculator.service.js";
import { statisticsService } from "../services/statistics.service.js";
import { pairSummaryService } from "../services/pair-summary.service.js";
import { dailyRollupService } from "../services/daily-rollup.service.js";
import { alertEngine } from "../services/alert-engine.service.js";
import { marketDataService } from "../services/market-data.service.js";
import { bymaConnector } from "../services/byma-connector.service.js";
import {
  candleQueryService,
  SUPPORTED_TIMEFRAMES,
} from "../services/candle-query.service.js";
import {
  getBondDailyCandles,
  getRatioDailyCandles,
} from "../services/bond-candles.service.js";
import { arbitrageOperationsService } from "../services/arbitrage-operations.service.js";
import { wsServer } from "../websocket/ws-server.js";
import { getLocalDateKey, getSessionConfig } from "../utils/session.js";
import type { StatsWindow, PairDaily, PairDailyBands } from "@arbitraje/shared";

// ============================================================
// Schemas de validación con Zod
// ============================================================

const createPairSchema = z.object({
  name: z.string().min(1),
  bondA: z.string().min(1),
  bondB: z.string().min(1),
  settlementA: z.enum(["CI", "24hs", "48hs"]),
  settlementB: z.enum(["CI", "24hs", "48hs"]),
  type: z.enum(["ratio", "spread"]).default("ratio"),
});

const statsWindowSchema = z.enum(["1w", "2w", "1m", "3m", "6m", "1y"]);

const createAlertSchema = z.object({
  pairId: z.string().min(1),
  field: z.enum(["ratio", "spread", "priceA", "priceB"]).default("ratio"),
  condition: z.enum(["above", "below", "cross_above", "cross_below"]),
  threshold: z.number(),
  message: z.string().optional(),
});

const historyQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().min(1).max(10000).default(1000),
});

const dateKeyRegex = /^\d{4}-\d{2}-\d{2}$/;

const dailyQuerySchema = z.object({
  from: z.string().regex(dateKeyRegex).optional(), // "YYYY-MM-DD"
  to: z.string().regex(dateKeyRegex).optional(),
  limit: z.coerce.number().min(1).max(2000).default(500),
});

const bandsQuerySchema = z.object({
  // `window` = cantidad de deltas a promediar. Para la fórmula nueva (ver el
  // handler de /api/pairs/:id/daily/bands) cada delta consume DOS filas, así
  // que la fila D necesita `window + 1` ruedas previas con datos.
  window: z.coerce.number().min(1).max(200).default(16),
  days: z.coerce.number().min(1).max(2000).default(30),
});

const backfillSchema = z.object({
  from: z.string().regex(dateKeyRegex),
  to: z.string().regex(dateKeyRegex),
});

const candlesQuerySchema = z.object({
  timeframe: z.enum(SUPPORTED_TIMEFRAMES).default("5m"),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().min(1).max(5000).default(500),
});

const settlementSchema = z.enum(["CI", "24hs", "48hs"]);

const bondCandlesQuerySchema = z.object({
  ticker: z.string().min(1),
  settlement: settlementSchema,
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().min(1).max(2000).default(1000),
});

const ratioCandlesQuerySchema = z.object({
  tickerA: z.string().min(1),
  settlementA: settlementSchema,
  tickerB: z.string().min(1),
  settlementB: settlementSchema,
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().min(1).max(2000).default(1000),
});

const openExerciseSchema = z.object({
  name: z.string().min(1),
  openingNotes: z.string().optional().default(""),
});

const closeExerciseSchema = z.object({
  closingNotes: z.string().optional().default(""),
});

const operationSideSchema = z.enum(["buy_ratio", "sell_ratio"]);

const createOperationSchema = z.object({
  side: operationSideSchema,
  nominalsA: z.number().positive(),
  nominalsB: z.number().positive(),
  priceA: z.number().positive(),
  priceB: z.number().positive(),
  timestamp: z.string().datetime().optional(),
  notes: z.string().optional().default(""),
});

const updateOperationSchema = z.object({
  side: operationSideSchema.optional(),
  nominalsA: z.number().positive().optional(),
  nominalsB: z.number().positive().optional(),
  priceA: z.number().positive().optional(),
  priceB: z.number().positive().optional(),
  timestamp: z.string().datetime().optional(),
  notes: z.string().optional(),
});

// ============================================================
// Registro de rutas
// ============================================================

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // ---- Health ----
  app.get("/api/health", async () => ({
    status: "ok",
    uptime: process.uptime(),
    market: marketDataService.getStats(),
    byma: bymaConnector.getStatus(),
    wsClients: wsServer.getClientCount(),
  }));

  // ---- Bonds (read-only) ----
  app.get("/api/bonds", async () => {
    const bonds = await BondModel.find().sort({ ticker: 1 }).lean();
    return {
      success: true,
      data: bonds.map((b) => ({ ...b, id: b._id.toString() })),
    };
  });

  // ---- Pairs CRUD ----
  app.get("/api/pairs", async () => {
    const pairs = await BondPairModel.find({ isActive: true }).lean();
    console.log("pairs", pairs);
    const liveDataMap = new Map(
      pairCalculatorService.getAllLiveData().map((d) => [d.pairId, d]),
    );

    return {
      success: true,
      data: pairs.map((p) => ({
        ...p,
        id: p._id.toString(),
        live: liveDataMap.get(p._id.toString()) ?? null,
      })),
    };
  });

  app.get<{ Params: { id: string } }>("/api/pairs/:id", async (req) => {
    const pair = await BondPairModel.findById(req.params.id).lean();
    if (!pair) return { success: false, error: "Par no encontrado" };

    const live = pairCalculatorService.getLiveData(pair._id.toString());
    return {
      success: true,
      data: { ...pair, id: pair._id.toString(), live: live ?? null },
    };
  });

  app.post("/api/pairs", async (req, reply) => {
    const parsed = createPairSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ success: false, error: parsed.error.format() });
    }

    const existing = await BondPairModel.findOne({ name: parsed.data.name });
    if (existing) {
      return reply
        .status(409)
        .send({ success: false, error: "Ya existe un par con ese nombre" });
    }

    const doc = await BondPairModel.create({ ...parsed.data, isActive: true });

    // Recargar pares en el calculador
    await pairCalculatorService.reloadPairs();

    return reply.status(201).send({
      success: true,
      data: { ...doc.toObject(), id: doc.id.toString() },
    });
  });

  app.delete<{ Params: { id: string } }>("/api/pairs/:id", async (req) => {
    await BondPairModel.findByIdAndUpdate(req.params.id, { isActive: false });
    await pairCalculatorService.reloadPairs();
    return { success: true };
  });

  // ---- Summary (referencias para la tabla principal) ----
  // Devuelve avgPrev/avg1w/avg1m/min1m/max1m por par (excluye el día corriente).
  // Se calcula 1× por carga del front; las diferencias % vs ratio actual las
  // resuelve el cliente con los datos en vivo.
  app.get("/api/pairs/summary", async () => {
    const summaries = await pairSummaryService.getAllSummaries();
    return { success: true, data: summaries };
  });

  // ---- Statistics ----
  app.get<{ Params: { id: string }; Querystring: { window?: string } }>(
    "/api/pairs/:id/stats",
    async (req, reply) => {
      const window = statsWindowSchema.safeParse(req.query.window ?? "1m");
      if (!window.success) {
        return reply
          .status(400)
          .send({ success: false, error: "Ventana inválida" });
      }

      const stats = await statisticsService.getStats(
        req.params.id,
        window.data,
      );
      if (!stats)
        return { success: false, error: "Sin datos para este par/ventana" };

      return { success: true, data: stats };
    },
  );

  app.get<{ Querystring: { window?: string } }>(
    "/api/stats",
    async (req, reply) => {
      const window = statsWindowSchema.safeParse(req.query.window ?? "1m");
      if (!window.success) {
        return reply
          .status(400)
          .send({ success: false, error: "Ventana inválida" });
      }

      const stats = await statisticsService.getAllStats(window.data);
      return { success: true, data: stats };
    },
  );

  // ---- History (para gráficos) ----
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
    "/api/pairs/:id/history",
    async (req, reply) => {
      const query = historyQuerySchema.safeParse(req.query); //safeParse convierte strings a números/fechas según el schema
      if (!query.success) {
        return reply
          .status(400)
          .send({ success: false, error: query.error.format() });
      }

      const filter: Record<string, unknown> = { pairId: req.params.id };
      if (query.data.from || query.data.to) {
        filter.timestamp = {};
        if (query.data.from)
          (filter.timestamp as Record<string, unknown>).$gte = new Date(
            query.data.from,
          );
        if (query.data.to)
          (filter.timestamp as Record<string, unknown>).$lte = new Date(
            query.data.to,
          );
      }

      const snapshots = await PairSnapshotModel.find(filter)
        .sort({ timestamp: -1 })
        .limit(query.data.limit)
        .lean();

      return { success: true, data: snapshots.reverse() };
    },
  );

  // ---- Candles (OHLCV) ----
  // Devuelve velas del par en el timeframe pedido. Las velas base son de
  // 5m (construidas en RAM por CandleBuilderService); timeframes mayores
  // se agregan al vuelo desde las 5m con un aggregation pipeline.
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
    "/api/pairs/:id/candles",
    async (req, reply) => {
      const query = candlesQuerySchema.safeParse(req.query);
      if (!query.success) {
        return reply
          .status(400)
          .send({ success: false, error: query.error.format() });
      }

      const candles = await candleQueryService.getCandles({
        pairId: req.params.id,
        timeframe: query.data.timeframe,
        from: query.data.from ? new Date(query.data.from) : undefined,
        to: query.data.to ? new Date(query.data.to) : undefined,
        limit: query.data.limit,
      });

      return { success: true, data: candles };
    },
  );

  // ---- Bond daily candles (vela diaria de un bono individual) ----
  // Agrega `BondSnapshot` por día local y devuelve OHLC del campo `price`.
  // Usado por la vista de gráficos cuando se elige sólo el activo A.
  app.get<{ Querystring: Record<string, string> }>(
    "/api/bonds/candles",
    async (req, reply) => {
      const query = bondCandlesQuerySchema.safeParse(req.query);
      if (!query.success) {
        return reply
          .status(400)
          .send({ success: false, error: query.error.format() });
      }

      const candles = await getBondDailyCandles({
        ticker: query.data.ticker,
        settlement: query.data.settlement,
        from: query.data.from ? new Date(query.data.from) : undefined,
        to: query.data.to ? new Date(query.data.to) : undefined,
        limit: query.data.limit,
      });

      return { success: true, data: candles };
    },
  );

  // ---- Ratio daily candles (vela diaria del cociente A/B) ----
  // Joinea `BondSnapshot` de A y B en buckets de 1 minuto, calcula ratio por
  // bucket y rolea a OHLC diario. Funciona con cualquier combinación A/B,
  // no requiere que exista un BondPair configurado.
  app.get<{ Querystring: Record<string, string> }>(
    "/api/ratio/candles",
    async (req, reply) => {
      const query = ratioCandlesQuerySchema.safeParse(req.query);
      if (!query.success) {
        return reply
          .status(400)
          .send({ success: false, error: query.error.format() });
      }

      const candles = await getRatioDailyCandles({
        a: { ticker: query.data.tickerA, settlement: query.data.settlementA },
        b: { ticker: query.data.tickerB, settlement: query.data.settlementB },
        from: query.data.from ? new Date(query.data.from) : undefined,
        to: query.data.to ? new Date(query.data.to) : undefined,
        limit: query.data.limit,
      });

      return { success: true, data: candles };
    },
  );

  // ---- Daily rollup ----
  // Devuelve las filas diarias del par en un rango. Sin `from/to`,
  // devuelve los últimos `limit` días disponibles (asc por fecha).
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
    "/api/pairs/:id/daily",
    async (req, reply) => {
      const query = dailyQuerySchema.safeParse(req.query);
      if (!query.success) {
        return reply
          .status(400)
          .send({ success: false, error: query.error.format() });
      }

      const filter: Record<string, unknown> = { pairId: req.params.id };
      if (query.data.from || query.data.to) {
        const dateFilter: Record<string, unknown> = {};
        if (query.data.from) dateFilter.$gte = query.data.from;
        if (query.data.to) dateFilter.$lte = query.data.to;
        filter.date = dateFilter;
      }

      const rows = await PairDailyModel.find(filter)
        .sort({ date: -1 })
        .limit(query.data.limit)
        .lean();

      return { success: true, data: rows.reverse() };
    },
  );

  // ============================================================
  // Bandas diarias dinámicas (nueva fórmula)
  // ============================================================
  //
  // Idea: tomar la "excursión" promedio del high (o low) respecto al promedio
  // de precios del día anterior, y proyectarla sobre el promedio de precios
  // de la rueda anterior a D. Da bandas que se mueven con el nivel reciente
  // del ratio en lugar de un piso/techo fijo.
  //
  // Sea `avgClose(D)` el promedio simple del close de las velas de 5m de la
  // fase 'regular' de D (calculado en el rollup, ver daily-rollup.service.ts).
  // Para una rueda D queremos:
  //
  //   delta_k     = high(D-k) − avgClose(D-k-1)         para k = 1..window
  //   upperBand(D) = avgClose(D-1) + (Σ delta_k) / window
  //
  //   delta_k     = low(D-k)  − avgClose(D-k-1)
  //   lowerBand(D) = avgClose(D-1) + (Σ delta_k) / window
  //                 ↑ los delta del low son ~siempre negativos, así que en la
  //                   práctica esto resta del avgClose de ayer.
  //
  // Cada delta consume DOS filas (D-k y D-k-1), por eso para D necesitamos
  // las `window + 1` ruedas previas con datos. Default `window = 16` ⇒ 17
  // filas previas.
  //
  // Si la última fila de pair_daily no es la de hoy (rollup aún no corrió),
  // appendeamos una fila sintética con date=hoy cuya banda usa las últimas
  // `window + 1` filas reales. high/low/avgClose quedan en null en esa fila.
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
    "/api/pairs/:id/daily/bands",
    async (req, reply) => {
      const query = bandsQuerySchema.safeParse(req.query);
      if (!query.success) {
        return reply
          .status(400)
          .send({ success: false, error: query.error.format() });
      }

      const pair = await BondPairModel.findById(req.params.id).lean();
      if (!pair) {
        return reply
          .status(404)
          .send({ success: false, error: "Par no encontrado" });
      }

      const w = query.data.window;
      // `days` filas con banda válida ⇒ necesito `days` filas de output;
      // cada banda requiere `w + 1` filas previas. Total a leer:
      const required = w + 1;
      const fetchCount = query.data.days + required;

      const rows = (await PairDailyModel.find({ pairId: req.params.id })
        .sort({ date: -1 })
        .limit(fetchCount)
        .lean()) as PairDaily[];

      const asc = rows.reverse();

      // Calcula upperBand/lowerBand para la fila en `asc[i]` usando la
      // fórmula descripta arriba. Devuelve null/null si no hay suficientes
      // filas previas (i < w + 1).
      const computeBands = (
        i: number,
      ): { upperBand: number | null; lowerBand: number | null } => {
        if (i < required) return { upperBand: null, lowerBand: null };
        // avgClose de la rueda anterior — base sobre la que proyectamos.
        const baseAvgClose = asc[i - 1].avgClose;
        let sumDeltaHigh = 0;
        let sumDeltaLow = 0;
        for (let k = 1; k <= w; k++) {
          // delta_k usa la rueda D-k (asc[i-k]) y la rueda D-k-1 (asc[i-k-1])
          sumDeltaHigh += asc[i - k].high - asc[i - k - 1].avgClose;
          sumDeltaLow += asc[i - k].low - asc[i - k - 1].avgClose;
        }
        return {
          upperBand: baseAvgClose + sumDeltaHigh / w,
          lowerBand: baseAvgClose + sumDeltaLow / w,
        };
      };

      const series: PairDailyBands["series"] = asc.map((row, i) => {
        const { upperBand, lowerBand } = computeBands(i);
        return {
          date: row.date,
          high: row.high,
          low: row.low,
          avgClose: row.avgClose,
          upperBand,
          lowerBand,
        };
      });

      // Fila sintética para la rueda en curso (cuando todavía no hay rollup
      // de hoy) — usa las últimas `w + 1` filas reales como D-1..D-(w+1).
      const cfg = getSessionConfig();
      const todayKey = getLocalDateKey(new Date(), cfg.timezone);
      const lastDate = asc[asc.length - 1]?.date;
      if (
        asc.length >= required &&
        lastDate !== todayKey &&
        todayKey > (lastDate ?? "")
      ) {
        // El "índice virtual" de hoy en `asc` sería asc.length, así que
        // computeBands(asc.length) reutiliza la misma lógica.
        const baseAvgClose = asc[asc.length - 1].avgClose;
        let sumDeltaHigh = 0;
        let sumDeltaLow = 0;
        for (let k = 1; k <= w; k++) {
          const idx = asc.length - k;
          sumDeltaHigh += asc[idx].high - asc[idx - 1].avgClose;
          sumDeltaLow += asc[idx].low - asc[idx - 1].avgClose;
        }
        series.push({
          date: todayKey,
          high: null,
          low: null,
          avgClose: null,
          upperBand: baseAvgClose + sumDeltaHigh / w,
          lowerBand: baseAvgClose + sumDeltaLow / w,
        });
      }

      // Recortamos a los últimos `days + 1` (para incluir hoy si fue
      // sintetizado) — el cliente no tiene que descartar nulls.
      const trimmed = series.slice(-(query.data.days + 1));

      const bands: PairDailyBands = {
        pairId: req.params.id,
        pairName: pair.name,
        window: w,
        series: trimmed,
      };

      return { success: true, data: bands };
    },
  );

  // Dispara un backfill manual del rollup para un rango de fechas.
  // Útil después de cambiar warmupMinutes/cooldownMinutes.
  app.post("/api/daily/backfill", async (req, reply) => {
    const parsed = backfillSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ success: false, error: parsed.error.format() });
    }

    await dailyRollupService.backfillRange(parsed.data.from, parsed.data.to);
    return { success: true };
  });

  // ---- Alerts CRUD ----
  app.get("/api/alerts", async () => {
    const alerts = await AlertConfigModel.find().sort({ createdAt: -1 }).lean();
    return {
      success: true,
      data: alerts.map((a) => ({ ...a, id: a._id.toString() })),
    };
  });

  app.post("/api/alerts", async (req, reply) => {
    const parsed = createAlertSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ success: false, error: parsed.error.format() });
    }

    // Buscar el nombre del par
    const pair = await BondPairModel.findById(parsed.data.pairId).lean();
    if (!pair) {
      return reply
        .status(404)
        .send({ success: false, error: "Par no encontrado" });
    }

    const doc = await AlertConfigModel.create({
      ...parsed.data,
      pairName: pair.name,
      status: "active",
    });

    await alertEngine.reloadAlerts();

    return reply.status(201).send({
      success: true,
      data: { ...doc.toObject(), id: doc.id.toString() },
    });
  });

  app.delete<{ Params: { id: string } }>("/api/alerts/:id", async (req) => {
    await AlertConfigModel.findByIdAndDelete(req.params.id);
    await alertEngine.reloadAlerts();
    return { success: true };
  });

  app.patch<{ Params: { id: string } }>(
    "/api/alerts/:id/reactivate",
    async (req) => {
      await AlertConfigModel.findByIdAndUpdate(req.params.id, {
        status: "active",
        triggeredAt: null,
      });
      await alertEngine.reloadAlerts();
      return { success: true };
    },
  );

  // ---- BYMA connection (manual) ----
  const bymaConnectSchema = z.object({
    sessionId: z.string().min(1),
    connId: z.string().min(1),
    wsSecKey: z.string().min(1),
  });

  app.post("/api/byma/connect", async (req, reply) => {
    const parsed = bymaConnectSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ success: false, error: parsed.error.format() });
    }

    // Desconectar si ya hay una conexión activa
    bymaConnector.disconnect();

    bymaConnector.setCredentials(
      parsed.data.sessionId,
      parsed.data.connId,
      parsed.data.wsSecKey,
    );
    bymaConnector.connect();

    return { success: true, data: bymaConnector.getStatus() };
  });

  app.post("/api/byma/disconnect", async () => {
    bymaConnector.disconnect();
    return { success: true, data: bymaConnector.getStatus() };
  });

  // ---- Live data ----
  app.get("/api/live", async () => {
    return {
      success: true,
      data: pairCalculatorService.getAllLiveData(),
    };
  });

  // ============================================================
  // Ejercicios y operaciones de arbitraje
  // ============================================================
  // Un "ejercicio" es un período manualmente abierto/cerrado por el usuario
  // sobre un par (ej. "Marzo 2026"). Sólo puede haber uno abierto por par.
  // Cada operación tiene dos patas (compra de un bono + venta del otro).
  // El PnL realizado se acumula por ciclos: cada vez que el saldo neto de
  // ambos bonos vuelve a 0, se cierra un ciclo y se suma su cash flow.
  // ============================================================

  app.get<{ Params: { id: string } }>(
    "/api/pairs/:id/exercises",
    async (req) => {
      const exercises = await arbitrageOperationsService.listExercisesForPair(
        req.params.id,
      );
      return { success: true, data: exercises };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/pairs/:id/exercises",
    async (req, reply) => {
      const parsed = openExerciseSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ success: false, error: parsed.error.format() });
      }

      try {
        const exercise = await arbitrageOperationsService.openExercise(
          req.params.id,
          parsed.data.name,
          parsed.data.openingNotes,
        );
        return reply.status(201).send({ success: true, data: exercise });
      } catch (err) {
        return reply.status(400).send({
          success: false,
          error: err instanceof Error ? err.message : "Error al abrir ejercicio",
        });
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/exercises/:id",
    async (req, reply) => {
      const detail = await arbitrageOperationsService.getExerciseDetail(
        req.params.id,
      );
      if (!detail) {
        return reply
          .status(404)
          .send({ success: false, error: "Ejercicio no encontrado" });
      }
      return { success: true, data: detail };
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/api/exercises/:id/close",
    async (req, reply) => {
      const parsed = closeExerciseSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ success: false, error: parsed.error.format() });
      }

      try {
        const exercise = await arbitrageOperationsService.closeExercise(
          req.params.id,
          parsed.data.closingNotes,
        );
        return { success: true, data: exercise };
      } catch (err) {
        return reply.status(400).send({
          success: false,
          error: err instanceof Error ? err.message : "Error al cerrar ejercicio",
        });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/exercises/:id/operations",
    async (req, reply) => {
      const parsed = createOperationSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ success: false, error: parsed.error.format() });
      }

      try {
        const op = await arbitrageOperationsService.createOperation(
          req.params.id,
          {
            side: parsed.data.side,
            nominalsA: parsed.data.nominalsA,
            nominalsB: parsed.data.nominalsB,
            priceA: parsed.data.priceA,
            priceB: parsed.data.priceB,
            timestamp: parsed.data.timestamp
              ? new Date(parsed.data.timestamp)
              : undefined,
            notes: parsed.data.notes,
          },
        );
        return reply.status(201).send({ success: true, data: op });
      } catch (err) {
        return reply.status(400).send({
          success: false,
          error: err instanceof Error ? err.message : "Error al crear operación",
        });
      }
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/api/operations/:id",
    async (req, reply) => {
      const parsed = updateOperationSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ success: false, error: parsed.error.format() });
      }

      try {
        const op = await arbitrageOperationsService.updateOperation(
          req.params.id,
          {
            side: parsed.data.side,
            nominalsA: parsed.data.nominalsA,
            nominalsB: parsed.data.nominalsB,
            priceA: parsed.data.priceA,
            priceB: parsed.data.priceB,
            timestamp: parsed.data.timestamp
              ? new Date(parsed.data.timestamp)
              : undefined,
            notes: parsed.data.notes,
          },
        );
        return { success: true, data: op };
      } catch (err) {
        return reply.status(400).send({
          success: false,
          error:
            err instanceof Error ? err.message : "Error al editar operación",
        });
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/operations/:id",
    async (req, reply) => {
      try {
        await arbitrageOperationsService.deleteOperation(req.params.id);
        return { success: true };
      } catch (err) {
        return reply.status(400).send({
          success: false,
          error:
            err instanceof Error ? err.message : "Error al borrar operación",
        });
      }
    },
  );
}
