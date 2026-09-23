import { describe, expect, test } from "bun:test";
import Elysia, { t } from "elysia";
import { ApplicationError } from "../errors/application.error";
import { ActionObserver } from "./action-observer";
import {
  A2_ACTION_REGISTRY,
  createA2TransportAuditPlugin,
  observeA2TransportFailure,
  resolveRegisteredA2Action,
} from "./a2-transport-audit.plugin";
import type { AuditEvent, AuditReceipt } from "../../features/audit/audit.repository";

const routeSamples = [
  ["GET", "/api/v1/shops", "organization.shop.list"],
  ["POST", "/api/v1/shops", "organization.shop.create"],
  ["GET", "/api/v1/shops/11", "organization.shop.read"],
  ["PATCH", "/api/v1/shops/11", "organization.shop.update"],
  ["POST", "/api/v1/shops/11/deactivate", "organization.shop.deactivate"],
  ["GET", "/api/v1/branches", "organization.branch.list"],
  ["POST", "/api/v1/branches", "organization.branch.create"],
  ["GET", "/api/v1/branches/12", "organization.branch.read"],
  ["PATCH", "/api/v1/branches/12", "organization.branch.update"],
  ["POST", "/api/v1/branches/12/deactivate", "organization.branch.deactivate"],
  ["GET", "/api/v1/departments", "organization.department.list"],
  ["POST", "/api/v1/departments", "organization.department.create"],
  ["GET", "/api/v1/departments/13", "organization.department.read"],
  ["PATCH", "/api/v1/departments/13", "organization.department.update"],
  ["POST", "/api/v1/departments/13/deactivate", "organization.department.deactivate"],
  ["GET", "/api/v1/positions", "organization.position.list"],
  ["POST", "/api/v1/positions", "organization.position.create"],
  ["GET", "/api/v1/positions/14", "organization.position.read"],
  ["PATCH", "/api/v1/positions/14", "organization.position.update"],
  ["POST", "/api/v1/positions/14/deactivate", "organization.position.deactivate"],
] as const;

const createObserver = (events: AuditEvent[]) => {
  const writer = {
    async insert(_executor: never, event: AuditEvent): Promise<AuditReceipt> {
      events.push(event);
      return { id: events.length, action: event.action, requestId: event.requestId };
    },
  };
  return new ActionObserver({} as never, writer as never);
};

describe("A2 organization transport audit", () => {
  test("registers exactly 20 unique public routes and action bases", () => {
    expect(A2_ACTION_REGISTRY).toHaveLength(20);

    const registrations = routeSamples.map(([method, path, actionBase]) => {
      const resolved = resolveRegisteredA2Action(new Request(`http://test${path}`, { method }));
      expect(resolved).not.toBeNull();
      expect(resolved!.registration.actionBase).toBe(actionBase);
      return `${resolved!.registration.method}:${resolved!.registration.pattern.source}:${actionBase}`;
    });

    expect(new Set(registrations).size).toBe(20);
    expect(new Set(A2_ACTION_REGISTRY.map(({ actionBase }) => actionBase)).size).toBe(20);
  });

  test("resolves collection sentinels, generated targets, and captured resource IDs", () => {
    const expectedTargets = [
      ["GET", "/api/v1/shops", "collection"],
      ["POST", "/api/v1/shops", "unknown"],
      ["GET", "/api/v1/shops/91", "91"],
      ["PATCH", "/api/v1/branches/92", "92"],
      ["POST", "/api/v1/departments/93/deactivate", "93"],
    ] as const;

    for (const [method, path, target] of expectedTargets) {
      const resolved = resolveRegisteredA2Action(new Request(`http://test${path}`, { method }));
      expect(resolved!.registration.recordId(resolved!.match)).toBe(target);
    }
  });

  test("records one failure per endpoint and does not duplicate an observed error", async () => {
    const events: AuditEvent[] = [];
    const observer = createObserver(events);

    for (const [index, [method, path, actionBase]] of routeSamples.entries()) {
      const error = new ApplicationError("VALIDATION_ERROR");
      const request = new Request(`http://test${path}`, { method });
      await observeA2TransportFailure(observer, request, `a2-${index}`, error);
      await observeA2TransportFailure(observer, request, `a2-${index}`, error);
      expect(events[index]?.action).toBe(`${actionBase}.failed`);
    }

    expect(events).toHaveLength(20);
    expect(events.every(({ reason }) => reason === "VALIDATION_ERROR")).toBe(true);
  });

  test("ignores preflight, DELETE, unknown, malformed-id, and non-A2 routes", () => {
    for (const request of [
      new Request("http://test/api/v1/shops", { method: "OPTIONS" }),
      new Request("http://test/api/v1/shops/1", { method: "DELETE" }),
      new Request("http://test/api/v1/shops/0"),
      new Request("http://test/api/v1/shops/not-an-id"),
      new Request("http://test/api/v1/accounts"),
      new Request("http://test/healthz"),
    ]) expect(resolveRegisteredA2Action(request)).toBeNull();
  });

  test("exported plugin audits framework validation failures", async () => {
    const events: AuditEvent[] = [];
    const observer = createObserver(events);
    const app = new Elysia()
      .use(createA2TransportAuditPlugin(observer))
      .post("/api/v1/shops", () => ({ ok: true }), {
        body: t.Object({ code: t.String(), name: t.String() }),
      });

    const response = await app.handle(new Request("http://test/api/v1/shops", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "a2-validation" },
      body: JSON.stringify({ code: "ONLY-CODE" }),
    }));

    expect(response.status).toBe(422);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "organization.shop.create.failed",
      tableName: "shops",
      recordId: "unknown",
      requestId: "a2-validation",
    });
  });
});
