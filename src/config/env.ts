import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(5000),
  APP_NAME: z.string().default("BuildBoard"),
  APP_URL: z.string().url(),
  API_PREFIX: z.string().default("/api/v1"),

  DATABASE_URL: z.string().min(1),

  REDIS_URL: z.string().min(1).optional(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES: z.string().default("15m"),
  REFRESH_SECRET: z.string().min(32),
  REFRESH_EXPIRES: z.string().default("30d"),

  CORS_ORIGIN: z.string().min(1),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("lax"),

  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  CLOUDINARY_URL: z.string().optional(),
  CLOUDINARY_FOLDER: z.string().optional(),

  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USERNAME: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  ENABLE_AI: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  ENABLE_SOCKET: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
  ENABLE_SIGNUP: z
    .string()
    .optional()
    .transform((v) => v !== "false"),

  LOG_LEVEL: z.string().default("debug"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
