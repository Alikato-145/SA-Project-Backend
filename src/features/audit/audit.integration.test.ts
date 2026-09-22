import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createActionContext } from "../../core/audit/action-context";
import { ActionObserver } from "../../core/audit/action-observer";
import { db, closeDatabase } from "../../core/db/client";
import { shops } from "../shop/shop.schema";
import { auditLogs } from "./audit.schema";
import { auditRepository } from "./audit.repository";

const databaseTest = process.env.DATABASE_URL ? test : test.skip;

describe("audit database contract", () => {
  databaseTest(
    "an audit insert failure rolls back its business mutation",
    async () => {
      const code = `AUDIT_ROLLBACK_${crypto.randomUUID().slice(0, 8)}`;
      await expect(
        db.transaction(async (tx) => {
          await tx.insert(shops).values({ code, name: "Must roll back" });
          await auditRepository.insert(tx, {
            actorAccountId: null,
            action: `organization.shop.${"x".repeat(80)}.succeeded`,
            tableName: "shops",
            recordId: "unknown",
            requestId: crypto.randomUUID(),
          });
        }),
      ).rejects.toThrow("Invalid audit action");

      const rows = await db
        .select({ id: shops.id })
        .from(shops)
        .where(eq(shops.code, code));
      expect(rows).toHaveLength(0);
    },
  );

  databaseTest(
    "a business rollback is followed by one separately committed failure row",
    async () => {
      const requestId = crypto.randomUUID();
      const code = `AUDIT_FAILURE_${crypto.randomUUID().slice(0, 8)}`;
      const context = createActionContext({
        requestId,
        actionBase: "organization.shop.create",
        target: { tableName: "shops", recordId: "unknown" },
      });
      const observer = new ActionObserver(db, auditRepository, {
        error: () => undefined,
      });

      await expect(
        observer.observeMutation(context, () =>
          db.transaction(async (tx) => {
            await tx.insert(shops).values({ code, name: "First" });
            await tx.insert(shops).values({ code, name: "Duplicate" });
            throw new Error("unreachable");
          }),
        ),
      ).rejects.toThrow();

      const businessRows = await db
        .select({ id: shops.id })
        .from(shops)
        .where(eq(shops.code, code));
      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.requestId, requestId));
      expect(businessRows).toHaveLength(0);
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]?.action).toBe("organization.shop.create.failed");
      expect(auditRows[0]?.reason).toBe("INTERNAL_ERROR");
    },
  );

  databaseTest(
    "database append-only protection rejects audit updates and deletes",
    async () => {
      const requestId = crypto.randomUUID();
      const receipt = await auditRepository.insert(db, {
        actorAccountId: null,
        action: "audit.contract.verify.succeeded",
        tableName: "audit_logs",
        recordId: "self",
        requestId,
      });
      await expect(
        Promise.resolve(
          db
            .update(auditLogs)
            .set({ reason: "STATE_CONFLICT" })
            .where(eq(auditLogs.id, receipt.id))
            .returning(),
        ),
      ).rejects.toThrow();
      await expect(
        Promise.resolve(
          db.delete(auditLogs).where(eq(auditLogs.id, receipt.id)).returning(),
        ),
      ).rejects.toThrow();
    },
  );
});

afterAll(async () => {
  if (process.env.DATABASE_URL) await closeDatabase();
});
