/**
 * Rutas REST del módulo Acciones. Se montan bajo /api/stocks.
 * Registrado desde bonds/routes.ts vía `registerStocksRoutes(app)`.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ArgStockModel, StockArbSettingsModel } from "./models.js";
import { stocksSnapshotService } from "./services/stocks-snapshot.service.js";
import { stockArbService } from "./services/stock-arb.service.js";

const arbSettingsSchema = z.object({
  tickers: z
    .array(z.string().regex(/^[A-Z0-9]+$/, "ticker sin plazo, ej. GGAL"))
    .optional(),
  costoCaucion: z.number().min(0).max(1).optional(),
});

export async function registerStocksRoutes(app: FastifyInstance) {
  // Settings del arbitraje CI/24hs. Los datos en vivo van por WS (canal "stocks").
  app.get("/api/stocks/arbitrage/settings", async () => {
    return { success: true, data: await stockArbService.getSettings() };
  });

  app.put("/api/stocks/arbitrage/settings", async (req, reply) => {
    const parsed = arbSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ success: false, error: parsed.error.format() });
    }
    const data = await StockArbSettingsModel.findOneAndUpdate(
      { _id: "global" },
      { $set: parsed.data },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
    await stockArbService.reload();
    return { success: true, data };
  });

  // Dispara el snapshot manualmente (útil para testear sin esperar a las 17h).
  app.post("/api/stocks/fetch", async (_req, reply) => {
    try {
      const result = await stocksSnapshotService.fetchAndStore();
      return { success: true, ...result };
    } catch (err) {
      app.log.error(err);
      return reply
        .status(502)
        .send({ success: false, error: (err as Error).message });
    }
  });

  // Lista las acciones de un día (default: el día más reciente guardado).
  app.get<{ Querystring: { date?: string } }>(
    "/api/stocks",
    async (req) => {
      let { date } = req.query;
      if (!date) {
        const latest = await ArgStockModel.findOne()
          .sort({ date: -1 })
          .select("date")
          .lean();
        date = latest?.date;
      }
      if (!date) return { success: true, date: null, data: [] };

      const data = await ArgStockModel.find({ date })
        .sort({ simbolo: 1 })
        .lean();
      return { success: true, date, data };
    },
  );

  // Historial de un símbolo (todos los días).
  app.get<{ Params: { simbolo: string } }>(
    "/api/stocks/:simbolo",
    async (req) => {
      const data = await ArgStockModel.find({
        simbolo: req.params.simbolo.toUpperCase(),
      })
        .sort({ date: -1 })
        .lean();
      return { success: true, data };
    },
  );
}
