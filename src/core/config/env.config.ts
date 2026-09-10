import { config } from "dotenv";
import z from "zod";
config();

const envSchema = z.object({
  ELYSIA_HOST: z.string().min(1).default("0.0.0.0"),
  ELYSIA_PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
