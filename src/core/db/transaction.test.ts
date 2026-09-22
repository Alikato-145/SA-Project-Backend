import { describe, expect, test } from "bun:test";
import type { Transaction } from "./transaction";

const originalDatabaseUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL ??= "postgresql://postgres@localhost/haris_payroll";

const { withTransaction } = await import("./transaction");

if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;

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
