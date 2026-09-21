import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { dbConfig } from "../config/config.db";
import * as schema from "../../db/schema";

export const pool = new Pool({ connectionString: dbConfig.databaseUrl });
export const db = drizzle({ client: pool, schema });

let closing: Promise<void> | undefined;

export const closeDatabase = () => {
  closing ??= pool.end();
  return closing;
};
