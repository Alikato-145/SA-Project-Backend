import Elysia from "elysia";
import { pool } from "../db/client";

export const databaseReady = async (query: () => Promise<unknown> = () => { const query = { text: "select 1", query_timeout: 2000 }; return pool.query(query); }) => {
  try { await query(); return true; } catch { return false; }
};
export const createHealthRoutes = () => new Elysia({ name:"health-routes" })
  .get("/health/live", () => ({ status:"ok" }))
  .get("/api/health/live", () => ({ status:"ok" }))
  .get("/api/health/ready", async ({set}) => { const ready=await databaseReady();set.status=ready ? 200 : 503;return {status:ready ? "ready" : "unavailable"}; })
  .get("/health/ready", async ({set}) => { const ready=await databaseReady();set.status=ready ? 200 : 503;return {status:ready ? "ready" : "unavailable"}; });
