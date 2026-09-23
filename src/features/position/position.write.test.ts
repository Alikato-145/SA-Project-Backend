import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { ActionObserver } from "../../core/audit/action-observer";
import { DomainAuditObserver } from "../../core/audit/domain-audit-observer";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { closeDatabase, db } from "../../core/db/client";
import type { AuditEvent, AuditEventWriter, AuditReceipt } from "../audit/audit.repository";
import type { AuditService } from "../audit/audit.service";
import type { PositionRecord } from "../organization/organization.types";
import { shops } from "../shop/shop.schema";
import {
  parseCreatePositionRequest,
  parseDeactivatePositionRequest,
  parseUpdatePositionRequest,
} from "./position.dto";
import { positionRepository, type PositionRepositoryPort } from "./position.repository";
import { createPositionRoutes } from "./position.routes";
import { positions } from "./position.schema";
import { createPositionService } from "./position.service";

const now = new Date("2026-09-22T05:00:00.000Z");
const existing: PositionRecord = {
  id: "8",
  shopId: "3",
  code: "CHEF",
  name: "Chef",
  isActive: true,
  createdAt: now,
  updatedAt: now,
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

const setup = (options: {
  shopActive?: boolean;
  auditFailure?: Error;
  deactivateRace?: boolean;
} = {}) => {
  let stored: PositionRecord | null = existing;
  const calls: Array<{ kind: string; value?: unknown }> = [];
  const events: AuditEvent[] = [];
  const repository: PositionRepositoryPort = {
    async resolveVisibleShopIds() { throw new Error("not used"); },
    async findPage() { throw new Error("not used"); },
    async findVisibleById() { throw new Error("not used"); },
    async findActiveShop(_executor, shopId) {
      calls.push({ kind: "findActiveShop", value: shopId });
      return options.shopActive !== false && shopId === "3";
    },
    async findById(_executor, id) {
      calls.push({ kind: "findById", value: id });
      return stored?.id === id ? stored : null;
    },
    async insert(_executor, input) {
      calls.push({ kind: "insert", value: input });
      stored = { id: "9", ...input, isActive: true, createdAt: now, updatedAt: now };
      return stored;
    },
    async update(_executor, id, input) {
      calls.push({ kind: "update", value: { id, input } });
      if (!stored || stored.id !== id) return null;
      stored = { ...stored, ...input, updatedAt: now };
      return stored;
    },
    async deactivate(_executor, id) {
      calls.push({ kind: "deactivate", value: id });
      if (options.deactivateRace || !stored || stored.id !== id || !stored.isActive) {
        return null;
      }
      stored = { ...stored, isActive: false, updatedAt: now };
      return stored;
    },
  };
  const writer: AuditEventWriter = {
    async insert(_executor, event): Promise<AuditReceipt> {
      if (options.auditFailure) throw options.auditFailure;
      events.push(event);
      return { id: events.length, action: event.action, requestId: event.requestId };
    },
  };
  const audit = {
    actions: new ActionObserver({} as never, writer),
    domain: new DomainAuditObserver(writer),
    async queryAuditLogs() { throw new Error("not used"); },
  } satisfies AuditService;
  const transactionRunner = {
    async transaction<T>(work: (executor: never) => Promise<T>): Promise<T> {
      calls.push({ kind: "transaction" });
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
    calls,
    events,
    getStored: () => stored,
    service: createPositionService({
      repository,
      rootExecutor: {} as never,
      transactionRunner,
      audit,
    }),
  };
};

describe("position write DTOs", () => {
  test("normalizes create/update and rejects parent changes", () => {
    expect(parseCreatePositionRequest({
      shop_id: "3", code: " CHEF ", name: " Head Chef ",
    })).toEqual({ shopId: "3", code: "CHEF", name: "Head Chef" });
    expect(parseUpdatePositionRequest({ name: " Sous Chef " })).toEqual({
      name: "Sous Chef",
    });
    expect(() => parseUpdatePositionRequest({ shop_id: "4", name: "Moved" }))
      .toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(parseDeactivatePositionRequest({ reason: "  Position retired  " }))
      .toEqual({ reason: "Position retired" });
    expect(() => parseDeactivatePositionRequest({ reason: "   " }))
      .toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(() => parseDeactivatePositionRequest({ reason: "x".repeat(501) }))
      .toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
  });
});

describe("position writes", () => {
  test.each(["OWNER", "HR"] as const)("allows %s to create under an active shop and audits atomically", async (roleCode) => {
    const fixture = setup();
    const record = await fixture.service.createPosition({
      actor: actor(roleCode), requestId: `position-create-${roleCode}`,
      shopId: "3", code: " CHEF ", name: " Head Chef ",
    });
    expect(record).toMatchObject({ id: "9", shopId: "3", code: "CHEF", name: "Head Chef" });
    expect(fixture.calls).toEqual([
      { kind: "transaction" },
      { kind: "findActiveShop", value: "3" },
      { kind: "insert", value: { shopId: "3", code: "CHEF", name: "Head Chef" } },
    ]);
    expect(fixture.events).toEqual([expect.objectContaining({
      action: "organization.position.create.succeeded",
      tableName: "positions",
      recordId: "unknown",
      newData: { id: "9", shop_id: "3", code: "CHEF", name: "Head Chef", is_active: true },
    })]);
  });

  test("updates safe fields without changing shop identity", async () => {
    const fixture = setup();
    const record = await fixture.service.updatePosition({
      actor: actor("OWNER"), requestId: "position-update", id: "8",
      code: undefined, name: " Sous Chef ",
    });
    expect(record).toMatchObject({ id: "8", shopId: "3", code: "CHEF", name: "Sous Chef" });
    expect(fixture.calls).toEqual([
      { kind: "transaction" },
      { kind: "findById", value: "8" },
      { kind: "update", value: { id: "8", input: { name: "Sous Chef" } } },
    ]);
    expect(fixture.events[0]).toMatchObject({
      action: "organization.position.update.succeeded",
      oldData: { id: "8", shop_id: "3", name: "Chef" },
      newData: { id: "8", shop_id: "3", name: "Sous Chef" },
    });
  });

  test("denies scoped writers and rejects inactive shops before insert", async () => {
    const denied = setup();
    await expect(denied.service.createPosition({
      actor: actor("BRANCH_MANAGER"), requestId: "denied", shopId: "3",
      code: "NO", name: "No",
    })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
    expect(denied.calls).toHaveLength(0);

    const inactive = setup({ shopActive: false });
    await expect(inactive.service.createPosition({
      actor: actor("OWNER"), requestId: "inactive", shopId: "3",
      code: "NO", name: "No",
    })).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    expect(inactive.calls).toEqual([
      { kind: "transaction" },
      { kind: "findActiveShop", value: "3" },
    ]);
  });

  test("rolls back the position mutation when the atomic domain audit fails", async () => {
    const failure = new Error("audit unavailable");
    const fixture = setup({ auditFailure: failure });
    const before = fixture.getStored();
    await expect(fixture.service.createPosition({
      actor: actor("OWNER"), requestId: "position-audit-rollback", shopId: "3",
      code: "ROLLBACK", name: "Must Roll Back",
    })).rejects.toBe(failure);
    expect(fixture.getStored()).toBe(before);
  });

  test.each(["OWNER", "HR"] as const)("allows %s to deactivate once and audits the reason", async (roleCode) => {
    const fixture = setup();
    const record = await fixture.service.deactivatePosition({
      actor: actor(roleCode), requestId: `position-deactivate-${roleCode}`,
      id: "8", reason: "  Position retired  ",
    });
    expect(record).toMatchObject({ id: "8", shopId: "3", isActive: false });
    expect(fixture.calls).toEqual([
      { kind: "transaction" },
      { kind: "findById", value: "8" },
      { kind: "deactivate", value: "8" },
    ]);
    expect(fixture.events[0]).toMatchObject({
      action: "organization.position.deactivate.succeeded",
      reason: "Position retired",
      oldData: { id: "8", shop_id: "3", is_active: true },
      newData: { id: "8", shop_id: "3", is_active: false },
    });
  });

  test("rejects missing, repeated, concurrent, and unauthorized deactivation", async () => {
    const missing = setup();
    await expect(missing.service.deactivatePosition({
      actor: actor("OWNER"), requestId: "missing", id: "99", reason: "Closed",
    })).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });

    const repeated = setup();
    await repeated.service.deactivatePosition({
      actor: actor("OWNER"), requestId: "first", id: "8", reason: "Closed",
    });
    await expect(repeated.service.deactivatePosition({
      actor: actor("OWNER"), requestId: "repeat", id: "8", reason: "Closed",
    })).rejects.toMatchObject({ code: "STATE_CONFLICT" });

    const raced = setup({ deactivateRace: true });
    await expect(raced.service.deactivatePosition({
      actor: actor("OWNER"), requestId: "race", id: "8", reason: "Closed",
    })).rejects.toMatchObject({ code: "STATE_CONFLICT" });

    const denied = setup();
    await expect(denied.service.deactivatePosition({
      actor: actor("BRANCH_MANAGER"), requestId: "denied", id: "8", reason: "Closed",
    })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
    expect(denied.calls).toHaveLength(0);
  });

  test("rolls deactivation back when its domain audit fails", async () => {
    const failure = new Error("audit unavailable");
    const fixture = setup({ auditFailure: failure });
    await expect(fixture.service.deactivatePosition({
      actor: actor("OWNER"), requestId: "deactivate-rollback", id: "8", reason: "Closed",
    })).rejects.toBe(failure);
    expect(fixture.getStored()).toMatchObject({ id: "8", isActive: true });
  });
});

describe("position mutation routes", () => {
  test("exposes CSRF-protected create/update/deactivate and rejects invalid bodies", async () => {
    const fixture = setup();
    const app = createPositionRoutes({
      service: fixture.service,
      allowedOrigins: ["http://localhost"],
      async authenticate() { return actor("OWNER"); },
    });
    const headers = { "content-type": "application/json", origin: "http://localhost" };
    const created = await app.handle(new Request("http://localhost/api/v1/positions", {
      method: "POST", headers,
      body: JSON.stringify({ shop_id: "3", code: "CHEF", name: "Head Chef" }),
    }));
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({ data: { id: "9", shop_id: "3" } });

    const reparent = await app.handle(new Request("http://localhost/api/v1/positions/8", {
      method: "PATCH", headers,
      body: JSON.stringify({ shop_id: "4", name: "Moved" }),
    }));
    expect(reparent.status).toBe(422);
    expect(await reparent.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    const missingOrigin = await app.handle(new Request("http://localhost/api/v1/positions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ shop_id: "3", code: "NO", name: "No" }),
    }));
    expect(missingOrigin.status).toBe(403);

    const deactivated = await app.handle(new Request("http://localhost/api/v1/positions/9/deactivate", {
      method: "POST", headers,
      body: JSON.stringify({ reason: " Position retired " }),
    }));
    expect(deactivated.status).toBe(200);
    expect(await deactivated.json()).toMatchObject({ data: { id: "9", is_active: false } });

    const unknown = await app.handle(new Request("http://localhost/api/v1/positions/9/deactivate", {
      method: "POST", headers,
      body: JSON.stringify({ reason: "Closed", extra: true }),
    }));
    expect(unknown.status).toBe(422);

    const whitespace = await app.handle(new Request("http://localhost/api/v1/positions/9/deactivate", {
      method: "POST", headers,
      body: JSON.stringify({ reason: "   " }),
    }));
    expect(whitespace.status).toBe(422);
  });
});

const databaseTest = process.env.A2_DATABASE_INTEGRATION === "1" ? test : test.skip;

describe("position repository database writes", () => {
  databaseTest("persists create/update and maps duplicate codes within one shop", async () => {
    const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
    await expect(db.transaction(async (executor) => {
      const [shop] = await executor.insert(shops).values({
        code: `PW${suffix}`, name: "Position write shop",
      }).returning();
      expect(shop).toBeDefined();
      expect(await positionRepository.findActiveShop(executor, String(shop!.id))).toBe(true);
      const first = await positionRepository.insert(executor, {
        shopId: String(shop!.id), code: `P${suffix}`, name: "First",
      });
      expect(first.shopId).toBe(String(shop!.id));
      expect(await positionRepository.update(executor, first.id, { name: "Updated" }))
        .toMatchObject({ name: "Updated", shopId: String(shop!.id) });
      expect(await positionRepository.deactivate(executor, first.id))
        .toMatchObject({ id: first.id, isActive: false });
      expect(await positionRepository.deactivate(executor, first.id)).toBeNull();
      await positionRepository.insert(executor, {
        shopId: String(shop!.id), code: `P${suffix}`, name: "Duplicate",
      });
    })).rejects.toMatchObject({ code: "DUPLICATE_CODE" });
    expect(await db.select().from(positions).where(eq(positions.code, `P${suffix}`)))
      .toHaveLength(0);
  });
});

afterAll(async () => {
  if (process.env.A2_DATABASE_INTEGRATION === "1") await closeDatabase();
});
