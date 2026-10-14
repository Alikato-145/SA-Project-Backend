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
  EMPLOYEE_BANK_ENCRYPTION_KEY_VERSION: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  EMPLOYEE_BANK_ENCRYPTION_KEYS: z.string().min(1),
  DATABASE_URL: z
    .string()
    .url()
    .refine((value) => value.startsWith("postgresql://") || value.startsWith("postgres://"), {
      message: "must use the PostgreSQL postgresql:// or postgres:// scheme",
    }),
}).superRefine((value,context)=>{
  if(value.NODE_ENV!=="production")return;
  if(value.AUTH_JWT_SECRET.startsWith("development-only")||value.AUTH_JWT_SECRET.startsWith("replace-with"))context.addIssue({code:"custom",path:["AUTH_JWT_SECRET"],message:"production requires a unique secret"});
  if(value.AUTH_ALLOWED_ORIGINS.some(origin=>!origin.startsWith("https://")))context.addIssue({code:"custom",path:["AUTH_ALLOWED_ORIGINS"],message:"production origins must use HTTPS"});
  if(value.EMPLOYEE_BANK_ENCRYPTION_KEYS.includes("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="))context.addIssue({code:"custom",path:["EMPLOYEE_BANK_ENCRYPTION_KEYS"],message:"production must not use the demo key"});
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
