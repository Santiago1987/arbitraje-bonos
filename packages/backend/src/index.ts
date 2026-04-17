import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import mongoose from "mongoose";

import { config } from "./config/index.js";
import { logger } from "./utils/logger.js";
import { registerRoutes } from "./routes/index.js";
import { wsServer } from "./websocket/ws-server.js";
import { pairCalculatorService } from "./services/pair-calculator.service.js";
import { snapshotService } from "./services/snapshot.service.js";
import { dailyRollupService } from "./services/daily-rollup.service.js";
import { alertEngine } from "./services/alert-engine.service.js";
import { bymaConnector } from "./services/byma-connector.service.js";

async function bootstrap() {
  // ── 1. Conectar a MongoDB ──
  logger.info("Conectando a MongoDB...");
  await mongoose.connect(config.MONGO_URI);
  logger.info("MongoDB conectado");

  // ── 2. Crear servidor Fastify ──
  const app = Fastify({ logger: false });

  await app.register(cors, {
    origin: true, // En producción, restringir al dominio del front
    credentials: true,
  });

  await app.register(websocket);

  // ── 3. Registrar rutas REST y WebSocket ──
  await registerRoutes(app);
  wsServer.register(app);

  // ── 4. Inicializar servicios (orden importa) ──
  //    PairCalculator necesita los pares de la BD y suscribirse a ticks
  //    AlertEngine necesita las alertas de la BD y suscribirse a pair updates
  //    SnapshotService empieza a persistir cada N segundos
  //    BymaConnector inicia la conexión con BYMA (los ticks empiezan a fluir)

  await pairCalculatorService.init();
  await alertEngine.init();
  snapshotService.start();
  dailyRollupService.start();

  // El conector BYMA ya NO se inicia automáticamente.
  // La conexión es manual via POST /api/byma/connect desde el frontend.

  // ── 5. Arrancar servidor HTTP ──
  await app.listen({ port: config.PORT, host: config.HOST });
  logger.info(`🚀 Servidor corriendo en http://${config.HOST}:${config.PORT}`);

  // ── Shutdown limpio ──
  const shutdown = async (signal: string) => {
    logger.info(`${signal} recibido, cerrando...`);
    bymaConnector.disconnect();
    snapshotService.stop();
    dailyRollupService.stop();
    await app.close();
    await mongoose.disconnect();
    logger.info("Servidor cerrado");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

bootstrap().catch((err) => {
  logger.fatal({ err }, "Error fatal al iniciar");
  process.exit(1);
});
