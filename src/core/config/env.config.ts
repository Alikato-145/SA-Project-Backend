import { config } from "dotenv";
import z from "zod";
config();

const envSchema = z.object({
  ELYSIA_HOST: z.string().min(1).default("0.0.0.0"),
  ELYSIA_PORT: z.coerce.number().default(3000),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  AUTH_JWT_SECRET: z.string().min(32, "must contain at least 32 characters"),
  AUTH_ALLOWED_ORIGINS: z
    .string()
    .min(1)
    .transform((value, context) => {
      const origins = value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);

      if (origins.length === 0 || origins.includes("*")) {
        context.addIssue({
          code: "custom",
          message: "must contain one or more exact origins and cannot contain *",
        });
        return z.NEVER;
      }

      const canonicalOrigins: string[] = [];
      for (const origin of origins) {
        try {
          const parsedOrigin = new URL(origin);
          if (
            parsedOrigin.origin === "null" ||
            parsedOrigin.username ||
            parsedOrigin.password ||
            parsedOrigin.pathname !== "/" ||
            parsedOrigin.search ||
            parsedOrigin.hash
          ) {
            throw new Error("not an exact origin");
          }
          canonicalOrigins.push(parsedOrigin.origin);
        } catch {
          context.addIssue({
            code: "custom",
            message: `contains an invalid exact origin: ${origin}`,
          });
          return z.NEVER;
        }
      }

      return [...new Set(canonicalOrigins)];
    }),
  AUTH_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(8 * 60 * 60),
  AUTH_MAX_FAILED_ATTEMPTS: z.coerce.number().int().positive().default(5),
  AUTH_LOCK_DURATION_SECONDS: z.coerce.number().int().positive().default(15 * 60),
  DATABASE_URL: z
    .string()
    .url()
    .refine((value) => value.startsWith("postgresql://") || value.startsWith("postgres://"), {
      message: "must use the PostgreSQL postgresql:// or postgres:// scheme",
    }),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
