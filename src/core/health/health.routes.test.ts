import { test, expect } from "bun:test";
import { databaseReady } from "./health.routes";
test("database readiness reports failures without returning connection details",async()=>{
  expect(await databaseReady(async()=>1)).toBe(true);
  expect(await databaseReady(async()=>{throw new Error("connection refused with secret DSN");})).toBe(false);
});
