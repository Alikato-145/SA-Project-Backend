import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { ActionObserver } from "../../core/audit/action-observer";
import { DomainAuditObserver } from "../../core/audit/domain-audit-observer";
import { closeDatabase, db } from "../../core/db/client";
import type { DatabaseExecutor, TransactionRunner } from "../../core/db/transaction";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { AuditEvent, AuditEventWriter, AuditReceipt } from "../audit/audit.repository";
import type { AuditService } from "../audit/audit.service";
import { branches } from "./branch.schema";
import { shops } from "../shop/shop.schema";
import type { BranchRecord } from "../organization/organization.types";
import {
  parseCreateBranchRequest,
  parseUpdateBranchRequest,
} from "./branch.dto";
import {
  branchRepository,
  type BranchRepositoryPort,
} from "./branch.repository";
import { createBranchRoutes } from "./branch.routes";
import { createBranchService } from "./branch.service";

const fixedNow = new Date("2026-09-22T03:00:00.000Z");
const existing: BranchRecord = {
  id: "7",
  shopId: "3",
  code: "BKK-01",
  name: "Bangkok Main",
  address: "1 Main Road",
  timezone: "Asia/Bangkok",
  isActive: true,
  createdAt: new Date("2026-09-20T01:02:03.000Z"),
  updatedAt: new Date("2026-09-21T04:05:06.000Z"),
};

const actor = (roleCode: "OWNER" | "HR" | "BRANCH_MANAGER"): AuthenticatedActor => ({
  accountId: "10",
  employeeId: null,
  username: roleCode.toLowerCase(),
  grants: [{
    grantId: "1",
    roleCode,
    scope: roleCode === "BRANCH_MANAGER" ? "branch" : "all",
    branchId: roleCode === "BRANCH_MANAGER" ? "7" : null,
    departmentId: null,
  }],
});

interface SetupOptions {
  shopActive?: boolean;
  auditFailure?: Error;
  deactivateConflict?: boolean;
}

const setup = (options: SetupOptions = {}) => {
  let stored: BranchRecord | null = existing;
  const repositoryCalls: Array<{ kind: string; value?: unknown }> = [];
  const auditEvents: AuditEvent[] = [];
  const repository: BranchRepositoryPort = {
    async findPage() {
      throw new Error("not used");
    },
    async findVisibleById() {
      throw new Error("not used");
    },
    async findActiveShop(_executor, shopId) {
      repositoryCalls.push({ kind: "findActiveShop", value: shopId });
      return options.shopActive !== false && shopId === "3";
    },
    async findById(_executor, id) {
      repositoryCalls.push({ kind: "findById", value: id });
      return stored?.id === id ? stored : null;
    },
    async insert(_executor, input) {
      repositoryCalls.push({ kind: "insert", value: input });
      stored = {
        id: "8",
        ...input,
        isActive: true,
        createdAt: fixedNow,
        updatedAt: fixedNow,
      };
      return stored;
    },
    async update(_executor, id, input) {
      repositoryCalls.push({ kind: "update", value: { id, input } });
      if (!stored || stored.id !== id) return null;
      stored = { ...stored, ...input, updatedAt: fixedNow };
      return stored;
    },
    async deactivate(_executor, id) {
      repositoryCalls.push({ kind: "deactivate", value: id });
      if (options.deactivateConflict) return null;
      if (!stored || stored.id !== id || !stored.isActive) return null;
      stored = { ...stored, isActive: false, updatedAt: fixedNow };
      return stored;
    },
  };

  const writer: AuditEventWriter = {
    async insert(_executor, event): Promise<AuditReceipt> {
      if (options.auditFailure && event.action.endsWith(".succeeded")) {
        throw options.auditFailure;
      }
      auditEvents.push(event);
      return { id: auditEvents.length, action: event.action, requestId: event.requestId };
    },
  };
  const audit = {
    actions: new ActionObserver({} as DatabaseExecutor, writer, { error() {} }),
    domain: new DomainAuditObserver(writer),
    async queryAuditLogs() {
      throw new Error("not used");
    },
  } satisfies AuditService;
  const transactionRunner: TransactionRunner = {
    async transaction(work) {
      const before = stored;
      try {
        return await work({} as never);
      } catch (error) {
        stored = before;
        throw error;
      }
    },
  };

  return {
    repositoryCalls,
    auditEvents,
    getStored: () => stored,
    service: createBranchService({
      repository,
      rootExecutor: {} as DatabaseExecutor,
      transactionRunner,
      audit,
    }),
  };
};

describe("branch write request validation", () => {
  test("normalizes create data and defaults timezone", () => {
    expect(parseCreateBranchRequest({
      shop_id: "3",
      code: " BKK-02 ",
      name: " Riverside ",
      address: "  2 River Road  ",
    })).toEqual({
      shopId: "3",
      code: "BKK-02",
      name: "Riverside",
      address: "2 River Road",
      timezone: "Asia/Bangkok",
    });
  });

  test("rejects invalid timezone, empty updates, and parent reassignment", () => {
    expect(() => parseCreateBranchRequest({
      shop_id: "3",
      code: "BKK-02",
      name: "Riverside",
      timezone: "Not/A-Timezone",
    })).toThrowError(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(() => parseUpdateBranchRequest({})).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
    expect(() => parseUpdateBranchRequest({ shop_id: "4", name: "Moved" })).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
  });
});

describe("branch write service", () => {
  test("Owner creates under an active shop and writes one atomic domain audit", async () => {
    const { service, repositoryCalls, auditEvents } = setup();
    const result = await service.createBranch({
      actor: actor("OWNER"),
      requestId: "branch-create",
      shopId: "3",
      code: " BKK-02 ",
      name: " Riverside ",
      address: " ",
      timezone: undefined,
    });

    expect(result).toMatchObject({
      id: "8",
      shopId: "3",
      code: "BKK-02",
      name: "Riverside",
      address: null,
      timezone: "Asia/Bangkok",
    });
    expect(repositoryCalls).toEqual([
      { kind: "findActiveShop", value: "3" },
      {
        kind: "insert",
        value: {
          shopId: "3",
          code: "BKK-02",
          name: "Riverside",
          address: null,
          timezone: "Asia/Bangkok",
        },
      },
    ]);
    expect(auditEvents).toEqual([
      expect.objectContaining({
        action: "organization.branch.create.succeeded",
        tableName: "branches",
        recordId: "unknown",
        requestId: "branch-create",
        newData: {
          id: "8",
          shop_id: "3",
          code: "BKK-02",
          name: "Riverside",
          address: null,
          timezone: "Asia/Bangkok",
          is_active: true,
        },
      }),
    ]);
  });

  test("HR updates safe fields without changing the branch parent", async () => {
    const { service, repositoryCalls, auditEvents } = setup();
    const result = await service.updateBranch({
      actor: actor("HR"),
      requestId: "branch-update",
      id: "7",
      code: undefined,
      name: " Bangkok Central ",
      address: null,
      timezone: "Asia/Tokyo",
    });

    expect(result).toMatchObject({
      id: "7",
      shopId: "3",
      name: "Bangkok Central",
      address: null,
      timezone: "Asia/Tokyo",
    });
    expect(repositoryCalls).toEqual([
      { kind: "findById", value: "7" },
      {
        kind: "update",
        value: {
          id: "7",
          input: { name: "Bangkok Central", address: null, timezone: "Asia/Tokyo" },
        },
      },
    ]);
    expect(auditEvents[0]).toMatchObject({
      action: "organization.branch.update.succeeded",
      recordId: "7",
      oldData: { id: "7", shop_id: "3", name: "Bangkok Main" },
      newData: { id: "7", shop_id: "3", name: "Bangkok Central" },
    });
  });

  test("denies scoped writers and rejects inactive parents before mutation", async () => {
    const scoped = setup();
    await expect(scoped.service.createBranch({
      actor: actor("BRANCH_MANAGER"), requestId: "denied", shopId: "3",
      code: "NO", name: "No", address: null, timezone: "Asia/Bangkok",
    })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
    expect(scoped.repositoryCalls).toHaveLength(0);

    const inactive = setup({ shopActive: false });
    await expect(inactive.service.createBranch({
      actor: actor("OWNER"), requestId: "inactive", shopId: "3",
      code: "NO", name: "No", address: null, timezone: "Asia/Bangkok",
    })).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    expect(inactive.repositoryCalls).toEqual([
      { kind: "findActiveShop", value: "3" },
    ]);
  });

  test("rolls the branch mutation back when the domain audit fails", async () => {
    const failure = new Error("audit unavailable");
    const state = setup({ auditFailure: failure });
    const before = state.getStored();
    await expect(state.service.createBranch({
      actor: actor("OWNER"), requestId: "rollback", shopId: "3",
      code: "ROLLBACK", name: "Rollback", address: null, timezone: "Asia/Bangkok",
    })).rejects.toBe(failure);
    expect(state.getStored()).toBe(before);
  });

  test("deactivates once with a trimmed audit reason and no parent mutation", async () => {
    const state = setup();
    const result = await state.service.deactivateBranch({
      actor: actor("OWNER"),
      requestId: "branch-deactivate",
      id: "7",
      reason: "  Seasonal closure  ",
    });

    expect(result).toMatchObject({ id: "7", shopId: "3", isActive: false });
    expect(state.repositoryCalls).toEqual([
      { kind: "findById", value: "7" },
      { kind: "deactivate", value: "7" },
    ]);
    expect(state.auditEvents).toHaveLength(1);
    expect(state.auditEvents[0]).toMatchObject({
      action: "organization.branch.deactivate.succeeded",
      recordId: "7",
      reason: "Seasonal closure",
      oldData: { id: "7", shop_id: "3", is_active: true },
      newData: { id: "7", shop_id: "3", is_active: false },
    });
  });

  test("rejects repeated and concurrent branch deactivation as state conflicts", async () => {
    const inactive = setup();
    await inactive.service.deactivateBranch({
      actor: actor("HR"), requestId: "branch-first", id: "7", reason: "Closed",
    });
    await expect(inactive.service.deactivateBranch({
      actor: actor("HR"), requestId: "branch-repeat", id: "7", reason: "Again",
    })).rejects.toMatchObject({ code: "STATE_CONFLICT" });

    const concurrent = setup({ deactivateConflict: true });
    await expect(concurrent.service.deactivateBranch({
      actor: actor("OWNER"), requestId: "branch-race", id: "7", reason: "Close",
    })).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    expect(concurrent.repositoryCalls).toEqual([
      { kind: "findById", value: "7" },
      { kind: "deactivate", value: "7" },
    ]);
  });

  test("rejects unauthorized, missing, and blank-reason branch deactivation", async () => {
    const denied = setup();
    await expect(denied.service.deactivateBranch({
      actor: actor("BRANCH_MANAGER"), requestId: "branch-denied",
      id: "7", reason: "Close",
    })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
    expect(denied.repositoryCalls).toHaveLength(0);

    const missing = setup();
    await expect(missing.service.deactivateBranch({
      actor: actor("OWNER"), requestId: "branch-missing",
      id: "99", reason: "Close",
    })).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });

    await expect(setup().service.deactivateBranch({
      actor: actor("OWNER"), requestId: "branch-blank-reason",
      id: "7", reason: "   ",
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  test("rolls back branch deactivation when its domain audit fails", async () => {
    const state = setup({ auditFailure: new Error("audit unavailable") });
    await expect(state.service.deactivateBranch({
      actor: actor("OWNER"), requestId: "branch-deactivate-rollback",
      id: "7", reason: "Close",
    })).rejects.toThrow("audit unavailable");
    expect(state.getStored()).toMatchObject({ id: "7", isActive: true });
  });
});

describe("branch mutation routes", () => {
  test("exposes create, update, and deactivate without accepting shop_id on update", async () => {
    const { service } = setup();
    const app = createBranchRoutes({
      service,
      allowedOrigins: ["http://localhost"],
      async authenticate() { return actor("OWNER"); },
    });

    const created = await app.handle(new Request("http://localhost/api/v1/branches", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ shop_id: "3", code: "BKK-02", name: "Riverside" }),
    }));
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({ data: { id: "8", shop_id: "3" } });

    const reparent = await app.handle(new Request("http://localhost/api/v1/branches/7", {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ shop_id: "4", name: "Moved" }),
    }));
    expect(reparent.status).toBe(422);
    expect(await reparent.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    const deactivated = await app.handle(new Request(
      "http://localhost/api/v1/branches/8/deactivate",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ reason: " Branch retired " }),
      },
    ));
    expect(deactivated.status).toBe(200);
    expect(await deactivated.json()).toMatchObject({
      data: { id: "8", shop_id: "3", is_active: false },
    });

    const blankReason = await app.handle(new Request(
      "http://localhost/api/v1/branches/8/deactivate",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ reason: "   " }),
      },
    ));
    expect(blankReason.status).toBe(422);
  });
});

const databaseTest = process.env.A2_DATABASE_INTEGRATION === "1" ? test : test.skip;

describe("branch repository database writes", () => {
  databaseTest("supports parent lookup and maps same-shop duplicate codes", async () => {
    const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
    await expect(db.transaction(async (executor) => {
      const [shop] = await executor.insert(shops).values({
        code: `BW${suffix}`,
        name: "Branch write shop",
      }).returning();
      expect(shop).toBeDefined();
      expect(await branchRepository.findActiveShop(executor, String(shop!.id))).toBe(true);

      const first = await branchRepository.insert(executor, {
        shopId: String(shop!.id),
        code: `B${suffix}`,
        name: "First",
        address: null,
        timezone: "Asia/Bangkok",
      });
      expect(first.shopId).toBe(String(shop!.id));
      const updated = await branchRepository.update(executor, first.id, {
        name: "Updated",
        timezone: "Asia/Tokyo",
      });
      expect(updated).toMatchObject({ name: "Updated", timezone: "Asia/Tokyo" });
      expect(await branchRepository.deactivate(executor, first.id)).toMatchObject({
        id: first.id,
        isActive: false,
      });
      expect(await branchRepository.deactivate(executor, first.id)).toBeNull();
      await branchRepository.insert(executor, {
        shopId: String(shop!.id),
        code: `B${suffix}`,
        name: "Duplicate",
        address: null,
        timezone: "Asia/Bangkok",
      });
    })).rejects.toMatchObject({ code: "DUPLICATE_CODE" });

    const rows = await db.select().from(branches).where(eq(branches.code, `B${suffix}`));
    expect(rows).toHaveLength(0);
  });
});

afterAll(async () => {
  if (process.env.A2_DATABASE_INTEGRATION === "1") await closeDatabase();
});
