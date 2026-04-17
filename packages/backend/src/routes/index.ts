import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  BondPairModel,
  PairSnapshotModel,
  AlertConfigModel,
} from "../models/index.js";
import { pairCalculatorService } from "../services/pair-calculator.service.js";
import { statisticsService } from "../services/statistics.service.js";
import { alertEngine } from "../services/alert-engine.service.js";
import { marketDataService } from "../services/market-data.service.js";
import { bymaConnector } from "../services/byma-connector.service.js";
import { wsServer } from "../websocket/ws-server.js";
import type { StatsWindow } from "@arbitraje/shared";

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
  condition: z.enum(["above", "below", "cross_above", "cross_below"]),
  threshold: z.number(),
  message: z.string().optional(),
});

const historyQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().min(1).max(10000).default(1000),
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
