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
import { wsServer } from "../websocket/ws-server.js";
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
  windows: z
    .string()
    .default("5,10,20")
    .transform((s) =>
      s
        .split(",")
        .map((n) => parseInt(n.trim(), 10))
        .filter((n) => Number.isFinite(n) && n > 0 && n <= 200),
    )
    .refine((arr) => arr.length > 0, "windows debe tener al menos un valor"),
  days: z.coerce.number().min(1).max(2000).default(120),
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
  // Devuelve avg1w/avg2w/avg1m/min1m/max1m por par (excluye el día corriente).
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

  // Bandas "tipo Bollinger" construidas con promedios móviles de high/low.
  // Devuelve la serie diaria con upperBand/lowerBand para cada `window`
  // pedido. El cálculo de rolling se hace al vuelo — no se persiste.
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

      const windows = query.data.windows;
      const maxWindow = Math.max(...windows);
      // Pedimos suficientes filas para que la primer fila devuelta ya
      // tenga `maxWindow` muestras previas disponibles.
      const fetchCount = query.data.days + maxWindow - 1;

      const rows = (await PairDailyModel.find({ pairId: req.params.id })
        .sort({ date: -1 })
        .limit(fetchCount)
        .lean()) as PairDaily[];

      const asc = rows.reverse();

      const bands: PairDailyBands[] = windows.map((w) => ({
        pairId: req.params.id,
        pairName: pair.name,
        window: w,
        series: asc.map((row, i) => {
          const start = i - w + 1;
          if (start < 0) {
            return {
              date: row.date,
              high: row.high,
              low: row.low,
              close: row.close,
              upperBand: null,
              lowerBand: null,
            };
          }
          let sumH = 0;
          let sumL = 0;
          for (let k = start; k <= i; k++) {
            sumH += asc[k].high;
            sumL += asc[k].low;
          }
          return {
            date: row.date,
            high: row.high,
            low: row.low,
            close: row.close,
            upperBand: sumH / w,
            lowerBand: sumL / w,
          };
        }),
      }));

      // Recortamos a los últimos `days` para que el cliente no tenga que
      // descartar las filas iniciales con bandas null.
      for (const b of bands) {
        if (b.series.length > query.data.days) {
          b.series = b.series.slice(b.series.length - query.data.days);
        }
      }

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
}
