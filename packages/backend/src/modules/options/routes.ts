/**
 * Rutas REST del módulo Opciones. Se montan bajo /api/options.
 * Registrado desde routes/index.ts vía `registerOptionsRoutes(app)`.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../../config/index.js";
import { pricingService, yearsToExpiry } from "./pricing.service.js";
import { payoffService } from "./payoff.service.js";
import { OptionStrategyModel } from "./models.js";
import { optionsDataProvider } from "./iol-options.connector.js";

const legSchema = z.object({
  id: z.string(),
  kind: z.enum(["option", "underlying"]),
  side: z.enum(["long", "short"]),
  quantity: z.number().positive(),
  entryPrice: z.number(),
  multiplier: z.number().positive().default(100),
  optionType: z.enum(["call", "put"]).optional(),
  strike: z.number().optional(),
  expiration: z.string().optional(),
  impliedVol: z.number().optional(),
  symbol: z.string().optional(),
});

const simulateSchema = z.object({
  spot: z.number().positive(),
  rate: z.number().optional(),
  legs: z.array(legSchema).min(1),
  priceRange: z
    .object({
      min: z.number(),
      max: z.number(),
      steps: z.number().int().positive().max(2000),
    })
    .optional(),
});

const pricingSchema = z.object({
  optionType: z.enum(["call", "put"]),
  spot: z.number().positive(),
  strike: z.number().positive(),
  expiration: z.string().optional(),
  timeToExpiry: z.number().nonnegative().optional(),
  rate: z.number().optional(),
  volatility: z.number().positive(),
  dividendYield: z.number().optional(),
});

const ivSchema = z.object({
  optionType: z.enum(["call", "put"]),
  marketPrice: z.number().positive(),
  spot: z.number().positive(),
  strike: z.number().positive(),
  expiration: z.string().optional(),
  timeToExpiry: z.number().nonnegative().optional(),
  rate: z.number().optional(),
  dividendYield: z.number().optional(),
});

const strategyBodySchema = z.object({
  name: z.string().min(1),
  underlying: z.string().min(1),
  spot: z.number().positive(),
  legs: z.array(legSchema),
});

export async function registerOptionsRoutes(app: FastifyInstance) {
  // ── Simular estrategia (curva de P&L + métricas) ──
  app.post("/api/options/simulate", async (req, reply) => {
    const parsed = simulateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.format() });
    }
    const result = payoffService.simulate({
      ...parsed.data,
      rate: parsed.data.rate ?? config.OPTIONS_RISK_FREE_RATE,
    });
    return { success: true, data: result };
  });

  // ── Precio teórico + griegas (Black-Scholes) ──
  app.post("/api/options/price", async (req, reply) => {
    const parsed = pricingSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.format() });
    }
    const d = parsed.data;
    const T = d.timeToExpiry ?? (d.expiration ? yearsToExpiry(d.expiration) : 0);
    const result = pricingService.price({
      optionType: d.optionType,
      spot: d.spot,
      strike: d.strike,
      timeToExpiry: T,
      rate: d.rate ?? config.OPTIONS_RISK_FREE_RATE,
      volatility: d.volatility,
      dividendYield: d.dividendYield,
    });
    return { success: true, data: result };
  });

  // ── Volatilidad implícita ──
  app.post("/api/options/implied-vol", async (req, reply) => {
    const parsed = ivSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.format() });
    }
    const d = parsed.data;
    const T = d.timeToExpiry ?? (d.expiration ? yearsToExpiry(d.expiration) : 0);
    const iv = pricingService.impliedVolatility({
      optionType: d.optionType,
      marketPrice: d.marketPrice,
      spot: d.spot,
      strike: d.strike,
      timeToExpiry: T,
      rate: d.rate ?? config.OPTIONS_RISK_FREE_RATE,
      dividendYield: d.dividendYield,
    });
    return { success: true, data: { impliedVol: iv } };
  });

  // ── Cadena de opciones desde el proveedor (IOL) ──
  app.get<{ Params: { underlying: string } }>(
    "/api/options/chain/:underlying",
    async (req, reply) => {
      try {
        const chain = await optionsDataProvider.getOptionChain(
          req.params.underlying.toUpperCase(),
        );
        return { success: true, data: chain };
      } catch (err) {
        return reply.status(502).send({
          success: false,
          error: err instanceof Error ? err.message : "Error consultando el proveedor",
        });
      }
    },
  );

  // ── CRUD de estrategias guardadas ──
  app.get("/api/options/strategies", async () => {
    const docs = await OptionStrategyModel.find().sort({ updatedAt: -1 }).lean();
    return {
      success: true,
      data: docs.map((d) => ({ ...d, id: String(d._id) })),
    };
  });

  app.post("/api/options/strategies", async (req, reply) => {
    const parsed = strategyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.format() });
    }
    const doc = await OptionStrategyModel.create(parsed.data);
    return { success: true, data: { ...doc.toObject(), id: String(doc._id) } };
  });

  app.put<{ Params: { id: string } }>(
    "/api/options/strategies/:id",
    async (req, reply) => {
      const parsed = strategyBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ success: false, error: parsed.error.format() });
      }
      const doc = await OptionStrategyModel.findByIdAndUpdate(
        req.params.id,
        parsed.data,
        { new: true },
      ).lean();
      if (!doc) return reply.status(404).send({ success: false, error: "No existe" });
      return { success: true, data: { ...doc, id: String(doc._id) } };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/options/strategies/:id",
    async (req, reply) => {
      const res = await OptionStrategyModel.findByIdAndDelete(req.params.id);
      if (!res) return reply.status(404).send({ success: false, error: "No existe" });
      return { success: true, data: { id: req.params.id } };
    },
  );
}
