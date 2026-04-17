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

  // --- Sesión de mercado ---
  SESSION_TIMEZONE: z.string().default("America/Argentina/Buenos_Aires"),
  SESSION_OPEN_TIME: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .default("10:30"),
  SESSION_CLOSE_TIME: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .default("17:00"),
  SESSION_WARMUP_MINUTES: z.coerce.number().min(0).default(10),
  SESSION_COOLDOWN_MINUTES: z.coerce.number().min(0).default(10),

  // --- Daily rollup ---
  DAILY_ROLLUP_INTERVAL_MS: z.coerce.number().default(5 * 60_000),

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
