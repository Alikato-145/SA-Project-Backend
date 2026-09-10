import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "mysql",
  schema: "./src/db/schema.ts",
  out: "./drizzle/mysql",
  dbCredentials: {
    // An empty value keeps `db:generate` usable without a running database.
    // `db:migrate` requires DATABASE_URL to be set in backend/.env.
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
