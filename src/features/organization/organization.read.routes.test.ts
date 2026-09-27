import { describe, expect, test } from "bun:test";
import Elysia from "elysia";
import { createA2TransportAuditPlugin, A2_ACTION_REGISTRY } from "../../core/audit/a2-transport-audit.plugin";
import { ActionObserver } from "../../core/audit/action-observer";
import { DomainAuditObserver } from "../../core/audit/domain-audit-observer";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { AuditEvent, AuditEventWriter } from "../audit/audit.repository";
import type { AuditService } from "../audit/audit.service";
import { createShopRoutes } from "../shop/shop.routes";
import { createShopService } from "../shop/shop.service";

const owner: AuthenticatedActor = {
  accountId: "1",
  employeeId: null,
  username: "owner",
  grants: [{
    grantId: "1", roleCode: "OWNER", scope: "all",
    branchId: null, departmentId: null,
  }],
};

const record = {
  id: "1",
  code: "HQ",
  name: "Headquarters",
  isActive: true,
  createdAt: new Date("2026-09-22T00:00:00.000Z"),
  updatedAt: new Date("2026-09-22T00:00:00.000Z"),
};

const harness = () => {
  const events: AuditEvent[] = [];
  const writer: AuditEventWriter = {
    async insert(_executor, event) {
      events.push(event);
      return { id: events.length, action: event.action, requestId: event.requestId };
    },
  };
  const actions = new ActionObserver({} as never, writer);
  const audit = {
    actions,
    domain: new DomainAuditObserver(writer),
    async queryAuditLogs() { throw new Error("not used"); },
  } satisfies AuditService;
  const service = createShopService({
    rootExecutor: {} as never,
    audit,
    repository: {
      async list(_executor, query) {
        return { items: [record], page: query.page, pageSize: query.pageSize, total: 1 };
      },
      async findById(_executor, id) {
        return id === record.id ? record : null;
      },
      async insert() { throw new Error("not used"); },
      async update() { throw new Error("not used"); },
      async deactivate() { throw new Error("not used"); },
    },
  });
  const app = new Elysia()
    .use(createA2TransportAuditPlugin(actions))
    .use(createShopRoutes({
      service,
      authenticate: async () => owner,
      allowedOrigins: ["http://localhost"],
    }));
  return { app, events };
};

describe("organization read route contracts", () => {
  test("registers list and detail actions for all four resources", () => {
    const getActions = A2_ACTION_REGISTRY
      .filter((registration) => registration.method === "GET")
      .map((registration) => registration.actionBase);
    expect(getActions).toEqual([
      "organization.shop.list", "organization.shop.read",
      "organization.branch.list", "organization.branch.read",
      "organization.department.list", "organization.department.read",
      "organization.position.list", "organization.position.read",
    ]);
  });

  test("returns stable list/detail envelopes and audits each success once", async () => {
    const fixture = harness();
    const list = await fixture.app.handle(new Request("http://localhost/api/v1/shops"));
    expect(list.status).toBe(200);
    expect(list.headers.get("x-request-id")).toBeTruthy();
    expect(await list.json()).toMatchObject({
      data: [{ id: "1", code: "HQ", is_active: true }],
      page: 1,
      page_size: 20,
      total: 1,
      request_id: expect.any(String),
    });

    const detail = await fixture.app.handle(new Request("http://localhost/api/v1/shops/1"));
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      data: { id: "1", code: "HQ", is_active: true },
      request_id: expect.any(String),
    });
    expect(fixture.events.map((event) => event.action)).toEqual([
      "organization.shop.list.succeeded",
      "organization.shop.read.succeeded",
    ]);
  });

  test("audits a controller validation failure once before returning its safe error", async () => {
    const fixture = harness();
    const response = await fixture.app.handle(new Request(
      "http://localhost/api/v1/shops?page=0",
      { headers: { "x-request-id": "invalid-shop-page" } },
    ));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
      request_id: "invalid-shop-page",
    });
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0]).toMatchObject({
      action: "organization.shop.list.failed",
      reason: "VALIDATION_ERROR",
      requestId: "invalid-shop-page",
    });
  });

  test("accepts the largest safe Shop ID and rejects the first unsafe integer", async () => {
    const fixture = harness();
    const accepted = await fixture.app.handle(new Request(
      "http://localhost/api/v1/shops/9007199254740991",
    ));
    expect(accepted.status).toBe(404);
    expect(await accepted.json()).toMatchObject({ error: { code: "RESOURCE_NOT_FOUND" } });

    const unsafe = await fixture.app.handle(new Request(
      "http://localhost/api/v1/shops/9007199254740992",
    ));
    expect(unsafe.status).toBe(422);
    expect(await unsafe.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });
});
