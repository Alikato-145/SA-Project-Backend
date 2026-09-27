import { afterAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { closeDatabase, db } from "../../core/db/client";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { auditRepository } from "../audit/audit.repository";
import { createAuditService } from "../audit/audit.service";
import { userAccounts } from "../user-account/user-account.schema";
import { shops } from "./shop.schema";
import { shopRepository } from "./shop.repository";
import { createShopRoutes } from "./shop.routes";
import { createShopService } from "./shop.service";

const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
const createdCodes = [`S${suffix}`, `R${suffix}`, `X${suffix}`, `D${suffix}`];
const databaseTest = process.env.A2_DATABASE_INTEGRATION === "1" ? test : test.skip;

const createActor = async (): Promise<AuthenticatedActor> => {
  const actorSuffix = crypto.randomUUID().slice(0, 8);
  const [account] = await db.insert(userAccounts).values({
    username: `a2.shop.${actorSuffix}`,
    passwordHash: "integration-test-not-a-real-password-hash",
  }).returning({ id: userAccounts.id });
  if (!account) throw new Error("Test account insert failed");
  return {
    accountId: String(account.id),
    employeeId: null,
    username: `a2.shop.${actorSuffix}`,
    grants: [{
      grantId: "1", roleCode: "OWNER", scope: "all",
      branchId: null, departmentId: null,
    }],
  };
};

describe("shop write database contract", () => {
  databaseTest("create/update/duplicate routes persist atomically with one audit outcome", async () => {
    const actor = await createActor();
    const audit = createAuditService(db, auditRepository, { error: () => undefined });
    const service = createShopService({
      repository: shopRepository,
      rootExecutor: db,
      transactionRunner: db,
      audit,
    });
    const app = createShopRoutes({
      service,
      authenticate: async () => actor,
      allowedOrigins: ["http://localhost"],
    });
    const headers = {
      origin: "http://localhost",
      "content-type": "application/json",
    };

    const createRequestId = `shop-create-${suffix}`;
    const created = await app.handle(new Request("http://localhost/api/v1/shops", {
      method: "POST",
      headers: { ...headers, "x-request-id": createRequestId },
      body: JSON.stringify({ code: createdCodes[0], name: "Database Shop" }),
    }));
    expect(created.status).toBe(200);
    const createdBody = await created.json() as { data: { id: string } };

    const updateRequestId = `shop-update-${suffix}`;
    const updated = await app.handle(new Request(`http://localhost/api/v1/shops/${createdBody.data.id}`, {
      method: "PATCH",
      headers: { ...headers, "x-request-id": updateRequestId },
      body: JSON.stringify({ code: createdCodes[1], name: "Renamed Database Shop" }),
    }));
    expect(updated.status).toBe(200);

    const deactivateRequestId = `shop-deactivate-${suffix}`;
    const deactivated = await app.handle(new Request(
      `http://localhost/api/v1/shops/${createdBody.data.id}/deactivate`,
      {
        method: "POST",
        headers: { ...headers, "x-request-id": deactivateRequestId },
        body: JSON.stringify({ reason: "  Database shop retired  " }),
      },
    ));
    expect(deactivated.status).toBe(200);
    expect(await deactivated.json()).toMatchObject({
      data: { id: createdBody.data.id, is_active: false },
    });

    const repeatedRequestId = `shop-deactivate-repeat-${suffix}`;
    const repeated = await app.handle(new Request(
      `http://localhost/api/v1/shops/${createdBody.data.id}/deactivate`,
      {
        method: "POST",
        headers: { ...headers, "x-request-id": repeatedRequestId },
        body: JSON.stringify({ reason: "Repeat" }),
      },
    ));
    expect(repeated.status).toBe(409);
    expect(await repeated.json()).toMatchObject({ error: { code: "STATE_CONFLICT" } });

    const duplicateRequestId = `shop-duplicate-${suffix}`;
    const duplicate = await app.handle(new Request("http://localhost/api/v1/shops", {
      method: "POST",
      headers: { ...headers, "x-request-id": duplicateRequestId },
      body: JSON.stringify({ code: createdCodes[1], name: "Duplicate" }),
    }));
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ error: { code: "DUPLICATE_CODE" } });

    for (const requestId of [
      createRequestId,
      updateRequestId,
      deactivateRequestId,
      repeatedRequestId,
      duplicateRequestId,
    ]) {
      const rows = await auditRepository.findByRequestId(db, requestId);
      expect(rows).toHaveLength(1);
    }
    expect((await auditRepository.findByRequestId(db, createRequestId))[0]).toMatchObject({
      action: "organization.shop.create.succeeded",
      newData: { id: createdBody.data.id, code: createdCodes[0] },
    });
    expect((await auditRepository.findByRequestId(db, duplicateRequestId))[0]).toMatchObject({
      action: "organization.shop.create.failed",
      reason: "DUPLICATE_CODE",
    });
    expect((await auditRepository.findByRequestId(db, deactivateRequestId))[0]).toMatchObject({
      action: "organization.shop.deactivate.succeeded",
      reason: "Database shop retired",
      oldData: { id: createdBody.data.id, is_active: true },
      newData: { id: createdBody.data.id, is_active: false },
    });
  });

  databaseTest("rolls back the shop when its domain audit insert fails", async () => {
    const actor = await createActor();
    const unavailableWriter = {
      async insert(): Promise<never> { throw new Error("audit unavailable"); },
    };
    const service = createShopService({
      repository: shopRepository,
      rootExecutor: db,
      transactionRunner: db,
      audit: createAuditService(db, unavailableWriter, { error: () => undefined }),
    });
    await expect(service.createShop({
      actor,
      requestId: `shop-audit-rollback-${suffix}`,
      code: createdCodes[2],
      name: "Must Roll Back",
    })).rejects.toThrow("audit unavailable");
    expect(await db.select().from(shops).where(eq(shops.code, createdCodes[2]))).toHaveLength(0);
  });

  databaseTest("rolls back shop deactivation when its domain audit insert fails", async () => {
    const [seeded] = await db.insert(shops).values({
      code: createdCodes[3],
      name: "Deactivation rollback shop",
    }).returning();
    if (!seeded) throw new Error("Shop seed did not return a row");

    const actor = await createActor();
    const unavailableWriter = {
      async insert(): Promise<never> { throw new Error("audit unavailable"); },
    };
    const service = createShopService({
      repository: shopRepository,
      rootExecutor: db,
      transactionRunner: db,
      audit: createAuditService(db, unavailableWriter, { error: () => undefined }),
    });

    await expect(service.deactivateShop({
      actor,
      requestId: `shop-deactivate-rollback-${suffix}`,
      shopId: String(seeded.id),
      reason: "Must roll back",
    })).rejects.toThrow("audit unavailable");
    expect(await db.select().from(shops).where(eq(shops.id, seeded.id))).toEqual([
      expect.objectContaining({ id: seeded.id, isActive: true }),
    ]);
  });
});

afterAll(async () => {
  if (process.env.A2_DATABASE_INTEGRATION !== "1") return;
  await db.delete(shops).where(inArray(shops.code, createdCodes));
  await closeDatabase();
});
