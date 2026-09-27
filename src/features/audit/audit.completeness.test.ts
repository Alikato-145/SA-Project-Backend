import { describe, expect, test } from "bun:test";
import Elysia, { t } from "elysia";
import { ApplicationError } from "../../core/errors/application.error";
import { ActionObserver } from "../../core/audit/action-observer";
import {
  A1_ACTION_REGISTRY,
  createA1TransportAuditPlugin,
  observeA1TransportFailure,
  resolveRegisteredA1Action,
} from "../../core/audit/a1-transport-audit.plugin";
import type { AuditEvent, AuditReceipt } from "./audit.repository";

const routeSamples = [
  ["POST", "/api/v1/auth/login"],
  ["POST", "/api/v1/auth/logout"],
  ["GET", "/api/v1/auth/me"],
  ["GET", "/api/v1/accounts"],
  ["POST", "/api/v1/accounts"],
  ["GET", "/api/v1/accounts/9"],
  ["PATCH", "/api/v1/accounts/9/status"],
  ["POST", "/api/v1/accounts/9/reset-password"],
  ["POST", "/api/v1/accounts/9/unlock"],
  ["GET", "/api/v1/roles"],
  ["POST", "/api/v1/accounts/9/roles"],
  ["DELETE", "/api/v1/accounts/9/roles/31"],
  ["GET", "/api/v1/audit-logs"],
] as const;

describe("A1 audit action completeness", () => {
  test("registers every public A1 endpoint exactly once", () => {
    expect(A1_ACTION_REGISTRY).toHaveLength(routeSamples.length);
    const actions = routeSamples.map(([method, path]) => {
      const resolved = resolveRegisteredA1Action(
        new Request(`http://test${path}`, { method }),
      );
      expect(resolved).not.toBeNull();
      return resolved!.registration.actionBase;
    });
    expect(new Set(actions).size).toBe(routeSamples.length);
  });

  test("records one canonical pre-service failure per endpoint and never duplicates an observed error", async () => {
    const events: AuditEvent[] = [];
    const writer = {
      async insert(_executor: never, event: AuditEvent): Promise<AuditReceipt> {
        events.push(event);
        return {
          id: events.length,
          action: event.action,
          requestId: event.requestId,
        };
      },
    };
    const observer = new ActionObserver({} as never, writer as never);
    for (const [index, [method, path]] of routeSamples.entries()) {
      const error = new ApplicationError("VALIDATION_ERROR");
      const request = new Request(`http://test${path}`, { method });
      await observeA1TransportFailure(
        observer,
        request,
        `request-${index}`,
        error,
      );
      await observeA1TransportFailure(
        observer,
        request,
        `request-${index}`,
        error,
      );
    }
    expect(events).toHaveLength(routeSamples.length);
    expect(events.every((event) => event.action.endsWith(".failed"))).toBe(
      true,
    );
    expect(events.every((event) => event.reason === "VALIDATION_ERROR")).toBe(
      true,
    );
  });

  test("excludes health, preflight, static, unknown routes, and audit insertion", () => {
    for (const request of [
      new Request("http://test/healthz"),
      new Request("http://test/api/v1/accounts", { method: "OPTIONS" }),
      new Request("http://test/favicon.ico"),
      new Request("http://test/api/v1/unknown"),
      new Request("http://test/internal/audit-insert", { method: "POST" }),
    ])
      expect(resolveRegisteredA1Action(request)).toBeNull();
  });

  test("the exported plugin observes framework validation failures before a service runs", async () => {
    const events: AuditEvent[] = [];
    const writer = {
      async insert(_executor: never, event: AuditEvent): Promise<AuditReceipt> {
        events.push(event);
        return {
          id: events.length,
          action: event.action,
          requestId: event.requestId,
        };
      },
    };
    const observer = new ActionObserver({} as never, writer as never);
    const app = new Elysia()
      .use(createA1TransportAuditPlugin(observer))
      .post("/api/v1/auth/login", () => ({ ok: true }), {
        body: t.Object({ username: t.String(), password: t.String() }),
      });

    const response = await app.handle(
      new Request("http://test/api/v1/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "request-validation",
        },
        body: JSON.stringify({ username: "missing-password" }),
      }),
    );
    expect(response.status).toBe(422);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "authentication.session.login.failed",
      requestId: "request-validation",
    });
  });
});
