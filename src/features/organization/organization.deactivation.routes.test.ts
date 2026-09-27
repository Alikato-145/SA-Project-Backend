import { describe, expect, test } from "bun:test";
import Elysia from "elysia";
import { A2_ACTION_REGISTRY, createA2TransportAuditPlugin } from "../../core/audit/a2-transport-audit.plugin";
import { ActionObserver } from "../../core/audit/action-observer";
import { DomainAuditObserver } from "../../core/audit/domain-audit-observer";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { AuditEvent, AuditEventWriter } from "../audit/audit.repository";
import type { AuditService } from "../audit/audit.service";
import type { ShopRepositoryPort } from "../shop/shop.repository";
import { createShopRoutes } from "../shop/shop.routes";
import { createShopService } from "../shop/shop.service";
import type { ShopRecord } from "./organization.types";

const now = new Date("2026-09-22T00:00:00.000Z");
const owner: AuthenticatedActor = {
  accountId: "1", employeeId: null, username: "owner",
  grants: [{
    grantId: "1", roleCode: "OWNER", scope: "all",
    branchId: null, departmentId: null,
  }],
};

const setup = (options: { active?: boolean; failDomainAudit?: boolean } = {}) => {
  let record: ShopRecord = {
    id: "7", code: "HISTORY", name: "Historical Shop",
    isActive: options.active !== false, createdAt: now, updatedAt: now,
  };
  const events: AuditEvent[] = [];
  const writer: AuditEventWriter = {
    async insert(_executor, event) {
      if (options.failDomainAudit && event.action.endsWith(".succeeded")) {
        throw new Error("audit unavailable");
      }
      events.push(event);
      return { id: events.length, action: event.action, requestId: event.requestId };
    },
  };
  const actions = new ActionObserver({} as never, writer, { error: () => undefined });
  const audit = {
    actions,
    domain: new DomainAuditObserver(writer),
    async queryAuditLogs() { throw new Error("not used"); },
  } satisfies AuditService;
  const repository = {
    async list() { throw new Error("not used"); },
    async findById() { return record; },
    async insert() { throw new Error("not used"); },
    async update() { throw new Error("not used"); },
    async deactivate() {
      if (!record.isActive) return null;
      record = { ...record, isActive: false, updatedAt: new Date() };
      return record;
    },
  } satisfies ShopRepositoryPort;
  const transactionRunner = {
    async transaction<T>(work: (executor: never) => Promise<T>): Promise<T> {
      const before = record;
      try {
        return await work({} as never);
      } catch (error) {
        record = before;
        throw error;
      }
    },
  };
  const service = createShopService({
    repository, rootExecutor: {} as never, transactionRunner, audit,
  });
  const app = new Elysia({ normalize: false })
    .use(createA2TransportAuditPlugin(actions))
    .use(createShopRoutes({
      service,
      allowedOrigins: ["http://localhost"],
      authenticate: async () => owner,
    }));
  return { app, events, isActive: () => record.isActive };
};

const request = (body: unknown, method = "POST") => new Request(
  "http://localhost/api/v1/shops/7/deactivate",
  {
    method,
    headers: {
      origin: "http://localhost",
      "content-type": "application/json",
      "x-request-id": "deactivation-route",
    },
    body: JSON.stringify(body),
  },
);

describe("organization deactivation route contracts", () => {
  test("registers one POST deactivation for every resource and no DELETE action", () => {
    const actions = A2_ACTION_REGISTRY.filter(({ actionBase }) =>
      actionBase.endsWith(".deactivate"));
    expect(actions).toHaveLength(4);
    expect(actions.every(({ method }) => method === "POST")).toBe(true);
    expect(A2_ACTION_REGISTRY.some(({ method }) => method === "DELETE")).toBe(false);
  });

  test("trims the reason and emits exactly one successful domain audit", async () => {
    const fixture = setup();
    const response = await fixture.app.handle(request({ reason: "  Closed for history  " }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { id: "7", is_active: false } });
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0]).toMatchObject({
      action: "organization.shop.deactivate.succeeded",
      reason: "Closed for history",
      oldData: { is_active: true },
      newData: { is_active: false },
    });
  });

  test.each([
    ["blank", { reason: "   " }],
    ["overlong", { reason: "x".repeat(501) }],
    ["unknown-field", { reason: "valid", extra: true }],
  ] as const)("rejects %s reason input with one outcome", async (_case, body) => {
    const fixture = setup();
    const response = await fixture.app.handle(request(body));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(fixture.isActive()).toBe(true);
    expect(fixture.events).toHaveLength(1);
  });

  test("maps repeated deactivation to STATE_CONFLICT once", async () => {
    const fixture = setup({ active: false });
    const response = await fixture.app.handle(request({ reason: "Again" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "STATE_CONFLICT" } });
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0]).toMatchObject({
      action: "organization.shop.deactivate.failed",
      reason: "STATE_CONFLICT",
    });
  });

  test("rolls back the business change when domain audit persistence fails", async () => {
    const fixture = setup({ failDomainAudit: true });
    const response = await fixture.app.handle(request({ reason: "Must roll back" }));
    expect(response.status).toBe(500);
    expect(fixture.isActive()).toBe(true);
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0]).toMatchObject({
      action: "organization.shop.deactivate.failed",
      reason: "INTERNAL_ERROR",
    });
  });
});
