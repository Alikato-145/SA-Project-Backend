import { describe, expect, test } from "bun:test";
import { ActionObserver } from "../../core/audit/action-observer";
import { DomainAuditObserver } from "../../core/audit/domain-audit-observer";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { ApplicationError } from "../../core/errors/application.error";
import type { AuditEvent, AuditEventWriter } from "../audit/audit.repository";
import type { AuditService } from "../audit/audit.service";
import type { ShopRecord } from "../organization/organization.types";
import type { ShopRepositoryPort } from "./shop.repository";
import { createShopService } from "./shop.service";
import { createShopRoutes } from "./shop.routes";

const timestamp = new Date("2026-09-22T00:00:00.000Z");
const base: ShopRecord = {
  id: "2", code: "HQ", name: "Headquarters", isActive: true,
  createdAt: timestamp, updatedAt: timestamp,
};

const actor = (roleCode: "OWNER" | "HR" | "BRANCH_MANAGER", scope: "all" | "branch"): AuthenticatedActor => ({
  accountId: "9", employeeId: null, username: "writer",
  grants: [{
    grantId: "1", roleCode, scope,
    branchId: scope === "branch" ? "10" : null,
    departmentId: null,
  }],
});

const setup = (overrides: Record<string, unknown> = {}) => {
  const events: AuditEvent[] = [];
  const calls: Array<{ operation: string; input?: unknown }> = [];
  let current = base;
  const repository = {
    async list() { throw new Error("not used"); },
    async findById() { return current; },
    async insert(_executor: unknown, input: { code: string; name: string }) {
      calls.push({ operation: "insert", input });
      current = { ...base, ...input };
      return current;
    },
    async update(_executor: unknown, id: string, input: { code?: string; name?: string }) {
      calls.push({ operation: "update", input: { id, ...input } });
      current = { ...current, ...input, updatedAt: new Date("2026-09-22T01:00:00.000Z") };
      return current;
    },
    async deactivate(_executor: unknown, id: string) {
      calls.push({ operation: "deactivate", input: { id } });
      if (current.id !== id || !current.isActive) return null;
      current = {
        ...current,
        isActive: false,
        updatedAt: new Date("2026-09-22T02:00:00.000Z"),
      };
      return current;
    },
    ...overrides,
  } as unknown as ShopRepositoryPort;
  const writer: AuditEventWriter = {
    async insert(_executor, event) {
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
    async transaction<T>(work: (executor: never) => Promise<T>) {
      calls.push({ operation: "transaction" });
      return work({} as never);
    },
  };
  return {
    calls,
    events,
    service: createShopService({
      repository,
      rootExecutor: {} as never,
      transactionRunner,
      audit,
    }),
  };
};

describe("shop writes", () => {
  test.each(["OWNER", "HR"] as const)("allows %s all-scope create with trimmed data and atomic domain audit", async (roleCode) => {
    const fixture = setup();
    const created = await fixture.service.createShop({
      actor: actor(roleCode, "all"),
      requestId: `shop-create-${roleCode}`,
      code: "  HQ  ",
      name: "  Headquarters  ",
    });
    expect(created).toMatchObject({ code: "HQ", name: "Headquarters", isActive: true });
    expect(fixture.calls).toEqual([
      { operation: "transaction" },
      { operation: "insert", input: { code: "HQ", name: "Headquarters" } },
    ]);
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0]).toMatchObject({
      action: "organization.shop.create.succeeded",
      recordId: "unknown",
      newData: { id: "2", code: "HQ", name: "Headquarters", is_active: true },
    });
  });

  test("denies scoped managers before mutation and records one failure", async () => {
    const fixture = setup();
    await expect(fixture.service.createShop({
      actor: actor("BRANCH_MANAGER", "branch"),
      requestId: "shop-create-denied",
      code: "NEW",
      name: "New Shop",
    })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
    expect(fixture.calls).toEqual([{ operation: "transaction" }]);
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0]).toMatchObject({
      action: "organization.shop.create.failed",
      reason: "FORBIDDEN_SCOPE",
    });
  });

  test("updates only supplied safe fields and audits old/new snapshots", async () => {
    const fixture = setup();
    const updated = await fixture.service.updateShop({
      actor: actor("OWNER", "all"),
      requestId: "shop-update",
      shopId: "2",
      code: undefined,
      name: "  Central Office  ",
    });
    expect(updated.name).toBe("Central Office");
    expect(fixture.calls[1]).toEqual({
      operation: "update",
      input: { id: "2", name: "Central Office" },
    });
    expect(fixture.events[0]).toMatchObject({
      action: "organization.shop.update.succeeded",
      oldData: { id: "2", name: "Headquarters" },
      newData: { id: "2", name: "Central Office" },
    });
  });

  test("returns stable validation, missing-resource, and duplicate errors", async () => {
    await expect(setup().service.updateShop({
      actor: actor("OWNER", "all"), requestId: "empty-update", shopId: "2",
      code: undefined, name: undefined,
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    await expect(setup({ async findById() { return null; } }).service.updateShop({
      actor: actor("OWNER", "all"), requestId: "missing", shopId: "99",
      code: "NEW", name: undefined,
    })).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });

    await expect(setup({ async insert() { throw new ApplicationError("DUPLICATE_CODE"); } }).service.createShop({
      actor: actor("OWNER", "all"), requestId: "duplicate",
      code: "HQ", name: "Duplicate",
    })).rejects.toMatchObject({ code: "DUPLICATE_CODE" });
  });

  test("deactivates once with a trimmed audit reason and old/new snapshots", async () => {
    const fixture = setup();
    const deactivated = await fixture.service.deactivateShop({
      actor: actor("HR", "all"),
      requestId: "shop-deactivate",
      shopId: "2",
      reason: "  Location closed permanently  ",
    });

    expect(deactivated).toMatchObject({ id: "2", isActive: false });
    expect(fixture.calls).toEqual([
      { operation: "transaction" },
      { operation: "deactivate", input: { id: "2" } },
    ]);
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0]).toMatchObject({
      action: "organization.shop.deactivate.succeeded",
      recordId: "2",
      reason: "Location closed permanently",
      oldData: { id: "2", is_active: true },
      newData: { id: "2", is_active: false },
    });
  });

  test("rejects repeated or concurrent shop deactivation as a state conflict", async () => {
    const inactive = setup({
      async findById() { return { ...base, isActive: false }; },
    });
    await expect(inactive.service.deactivateShop({
      actor: actor("OWNER", "all"), requestId: "shop-inactive",
      shopId: "2", reason: "Already closed",
    })).rejects.toMatchObject({ code: "STATE_CONFLICT" });

    const concurrent = setup({ async deactivate() { return null; } });
    await expect(concurrent.service.deactivateShop({
      actor: actor("OWNER", "all"), requestId: "shop-race",
      shopId: "2", reason: "Close",
    })).rejects.toMatchObject({ code: "STATE_CONFLICT" });
  });

  test("rejects unauthorized, missing, and blank-reason shop deactivation", async () => {
    const denied = setup();
    await expect(denied.service.deactivateShop({
      actor: actor("BRANCH_MANAGER", "branch"), requestId: "shop-denied",
      shopId: "2", reason: "Close",
    })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
    expect(denied.calls).toEqual([{ operation: "transaction" }]);

    await expect(setup({ async findById() { return null; } }).service.deactivateShop({
      actor: actor("OWNER", "all"), requestId: "shop-missing",
      shopId: "99", reason: "Close",
    })).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });

    await expect(setup().service.deactivateShop({
      actor: actor("OWNER", "all"), requestId: "shop-blank-reason",
      shopId: "2", reason: "   ",
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  test("exposes CSRF-protected create, update, and deactivate route contracts", async () => {
    const fixture = setup();
    const app = createShopRoutes({
      service: fixture.service,
      authenticate: async () => actor("OWNER", "all"),
      allowedOrigins: ["http://localhost"],
    });
    const headers = {
      origin: "http://localhost",
      "content-type": "application/json",
    };
    const created = await app.handle(new Request("http://localhost/api/v1/shops", {
      method: "POST",
      headers,
      body: JSON.stringify({ code: " NEW ", name: " New Shop " }),
    }));
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({
      data: { code: "NEW", name: "New Shop", is_active: true },
      request_id: expect.any(String),
    });

    const updated = await app.handle(new Request("http://localhost/api/v1/shops/2", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ name: " Renamed " }),
    }));
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      data: { id: "2", name: "Renamed" },
      request_id: expect.any(String),
    });

    const deactivated = await app.handle(new Request(
      "http://localhost/api/v1/shops/2/deactivate",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ reason: " Location closed " }),
      },
    ));
    expect(deactivated.status).toBe(200);
    expect(await deactivated.json()).toMatchObject({
      data: { id: "2", is_active: false },
      request_id: expect.any(String),
    });

    const rejected = await app.handle(new Request("http://localhost/api/v1/shops", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "NO", name: "No Origin" }),
    }));
    expect(rejected.status).toBe(403);
    expect(await rejected.json()).toMatchObject({ error: { code: "ORIGIN_NOT_ALLOWED" } });

    const deactivateWithoutOrigin = await app.handle(new Request(
      "http://localhost/api/v1/shops/2/deactivate",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "No origin" }),
      },
    ));
    expect(deactivateWithoutOrigin.status).toBe(403);
  });
});
