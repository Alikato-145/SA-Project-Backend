import { describe, expect, test } from "bun:test";
import type { Transaction } from "./transaction";

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalJwtSecret = process.env.AUTH_JWT_SECRET;
const originalAllowedOrigins = process.env.AUTH_ALLOWED_ORIGINS;
process.env.DATABASE_URL ??= "postgresql://postgres@localhost/haris_payroll";
process.env.AUTH_JWT_SECRET ??= "test-only-secret-that-is-at-least-32-characters";
process.env.AUTH_ALLOWED_ORIGINS ??= "http://localhost:3000";

const { withTransaction } = await import("./transaction");

if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
if (originalJwtSecret === undefined) delete process.env.AUTH_JWT_SECRET;
if (originalAllowedOrigins === undefined) delete process.env.AUTH_ALLOWED_ORIGINS;

describe("withTransaction", () => {
  test("returns the transaction callback result", async () => {
    const executor = {
      transaction: async <T>(work: (tx: Transaction) => Promise<T>) =>
        work({} as Transaction),
    };

    await expect(withTransaction(async () => "committed", executor)).resolves.toBe(
      "committed",
    );
  });

  test("preserves transaction failures for the caller", async () => {
    const error = new Error("rollback");
    const executor = {
      transaction: async <T>(work: (tx: Transaction) => Promise<T>) =>
        work({} as Transaction),
    };

    await expect(
      withTransaction(async () => {
        throw error;
      }, executor),
    ).rejects.toBe(error);
  });
});
