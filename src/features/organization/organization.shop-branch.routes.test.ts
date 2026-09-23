import { describe, expect, test } from "bun:test";
import Elysia from "elysia";
import { A2_ACTION_REGISTRY, createA2TransportAuditPlugin } from "../../core/audit/a2-transport-audit.plugin";
import { ActionObserver } from "../../core/audit/action-observer";
import { DomainAuditObserver } from "../../core/audit/domain-audit-observer";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { ApplicationError } from "../../core/errors/application.error";
import type { AuditEvent, AuditEventWriter } from "../audit/audit.repository";
import type { AuditService } from "../audit/audit.service";
import { parseUpdateBranchRequest } from "../branch/branch.dto";
import { createShopRoutes } from "../shop/shop.routes";
import { createShopService } from "../shop/shop.service";

const actor = (owner: boolean): AuthenticatedActor => ({
  accountId: owner ? "1" : "2",
  employeeId: null,
  username: owner ? "owner" : "manager",
  grants: [owner
    ? { grantId: "1", roleCode: "OWNER", scope: "all", branchId: null, departmentId: null }
    : { grantId: "2", roleCode: "BRANCH_MANAGER", scope: "branch", branchId: "10", departmentId: null }],
});

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
    transactionRunner: { async transaction(work) { return work({} as never); } },
    audit,
    repository: {
      async list() { throw new Error("not used"); },
      async findById() { return null; },
      async insert() { throw new ApplicationError("DUPLICATE_CODE"); },
      async update() { return null; },
      async deactivate() { return null; },
    },
  });
  const app = new Elysia()
    .use(createA2TransportAuditPlugin(actions))
    .use(createShopRoutes({
      service,
      allowedOrigins: ["http://localhost"],
      authenticate: async (request) => actor(request.headers.get("x-test-owner") === "true"),
    }));
  return { app, events };
};

const mutationRequest = (requestId: string, owner: boolean) => new Request(
  "http://localhost/api/v1/shops",
  {
    method: "POST",
    headers: {
      origin: "http://localhost",
      "content-type": "application/json",
      "x-request-id": requestId,
      "x-test-owner": String(owner),
    },
    body: JSON.stringify({ code: "HQ", name: "Duplicate" }),
  },
);

describe("shop and branch mutation route contracts", () => {
  test("registers create/update actions for both resources and no DELETE action", () => {
    const actions = A2_ACTION_REGISTRY.filter((item) =>
      item.actionBase.startsWith("organization.shop.") ||
      item.actionBase.startsWith("organization.branch."));
    expect(actions.filter((item) => ["POST", "PATCH"].includes(item.method))).toHaveLength(6);
    expect(actions.some((item) => item.method === "DELETE")).toBe(false);
  });

  test("rejects a scoped writer once without duplicate transport audit", async () => {
    const fixture = harness();
    const response = await fixture.app.handle(mutationRequest("shop-writer-denied", false));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN_SCOPE" } });
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0]).toMatchObject({
      action: "organization.shop.create.failed",
      reason: "FORBIDDEN_SCOPE",
    });
  });

  test("maps duplicate persistence to one stable conflict audit outcome", async () => {
    const fixture = harness();
    const response = await fixture.app.handle(mutationRequest("shop-code-duplicate", true));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "DUPLICATE_CODE" } });
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0]).toMatchObject({
      action: "organization.shop.create.failed",
      reason: "DUPLICATE_CODE",
    });
  });

  test("rejects Branch parent reassignment at the public DTO boundary", () => {
    expect(() => parseUpdateBranchRequest({ shop_id: "99", name: "Moved" }))
      .toThrowError(expect.objectContaining({ code: "VALIDATION_ERROR" }));
  });
});
