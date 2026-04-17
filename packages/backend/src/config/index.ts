import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  MONGO_URI: z.string().url(),
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default("0.0.0.0"),

  BYMA_WS_URL: z.string().default("ws://localhost:9000"),
  BYMA_RECONNECT_MAX_RETRIES: z.coerce.number().default(10),
  BYMA_RECONNECT_BASE_DELAY_MS: z.coerce.number().default(1000),

  SNAPSHOT_INTERVAL_MS: z.coerce.number().default(60_000),
  ALERT_COOLDOWN_MS: z.coerce.number().default(60_000),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  console.error(parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;
