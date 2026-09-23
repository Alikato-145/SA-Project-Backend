import { describe, expect, test } from "bun:test";
import Elysia, { t } from "elysia";
import { ApplicationError } from "../errors/application.error";
import type {
  AuditEvent,
  AuditReceipt,
} from "../../features/audit/audit.repository";
import { createActionContext } from "./action-context";
import { ActionObserver } from "./action-observer";
import {
  A3_ACTION_REGISTRY,
  createA3TransportAuditPlugin,
  observeA3TransportFailure,
  resolveRegisteredA3Action,
} from "./a3-transport-audit.plugin";

const routeSamples = [
  [
    "GET",
    "/api/v1/employees",
    "employee.profile.list",
    "employees",
    "collection",
  ],
  [
    "POST",
    "/api/v1/employees",
    "employee.profile.create",
    "employees",
    "unknown",
  ],
  ["GET", "/api/v1/employees/11", "employee.profile.read", "employees", "11"],
  [
    "PATCH",
    "/api/v1/employees/11",
    "employee.profile.update",
    "employees",
    "11",
  ],
  [
    "PATCH",
    "/api/v1/employees/11/status",
    "employee.status.change",
    "employees",
    "11",
  ],
  [
    "POST",
    "/api/v1/employees/onboard",
    "employee.profile.onboard",
    "employees",
    "unknown",
  ],
  [
    "GET",
    "/api/v1/employees/11/assignments",
    "employee.assignment.list",
    "employment_assignments",
    "11",
  ],
  [
    "POST",
    "/api/v1/employees/11/assignments",
    "employee.assignment.create",
    "employment_assignments",
    "11",
  ],
  [
    "GET",
    "/api/v1/employees/11/bank-accounts",
    "employee.bank.list",
    "employee_bank_accounts",
    "11",
  ],
  [
    "POST",
    "/api/v1/employees/11/bank-accounts",
    "employee.bank.create",
    "employee_bank_accounts",
    "11",
  ],
  [
    "PATCH",
    "/api/v1/employees/11/bank-accounts/12",
    "employee.bank.update",
    "employee_bank_accounts",
    "12",
  ],
  [
    "POST",
    "/api/v1/employees/11/bank-accounts/12/make-primary",
    "employee.bank.make-primary",
    "employee_bank_accounts",
    "12",
  ],
  [
    "POST",
    "/api/v1/employees/11/bank-accounts/12/deactivate",
    "employee.bank.deactivate",
    "employee_bank_accounts",
    "12",
  ],
  [
    "GET",
    "/api/v1/employees/11/weekly-holidays",
    "employee.holiday.list",
    "employee_weekly_holidays",
    "11",
  ],
  [
    "POST",
    "/api/v1/employees/11/weekly-holidays",
    "employee.holiday.create",
    "employee_weekly_holidays",
    "11",
  ],
  [
    "POST",
    "/api/v1/employees/11/weekly-holidays/13/end",
    "employee.holiday.end",
    "employee_weekly_holidays",
    "13",
  ],
] as const;

const createObserver = (events: AuditEvent[]) => {
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
  return new ActionObserver({} as never, writer as never);
};

describe("A3 employee transport audit", () => {
  test("registers exactly 16 distinct public actions with safe targets", () => {
    expect(A3_ACTION_REGISTRY).toHaveLength(16);
    expect(
      new Set(A3_ACTION_REGISTRY.map(({ actionBase }) => actionBase)).size,
    ).toBe(16);

    for (const [
      method,
      path,
      actionBase,
      tableName,
      recordId,
    ] of routeSamples) {
      const resolved = resolveRegisteredA3Action(
        new Request(`http://test${path}`, { method }),
      );
      expect(resolved).not.toBeNull();
      expect(resolved!.registration.actionBase).toBe(actionBase);
      expect(resolved!.registration.tableName).toBe(tableName);
      expect(resolved!.registration.recordId(resolved!.match)).toBe(recordId);
    }
  });

  test("records one redacted failure per request error, even when observed twice", async () => {
    const events: AuditEvent[] = [];
    const observer = createObserver(events);
    const secret = "1234567890123456";

    for (const [
      index,
      [method, path, actionBase, tableName, recordId],
    ] of routeSamples.entries()) {
      const error = new ApplicationError("VALIDATION_ERROR", {
        cause: new Error(`Sensitive value: ${secret}`),
      });
      const request = new Request(`http://test${path}`, { method });
      await observeA3TransportFailure(observer, request, `a3-${index}`, error);
      await observeA3TransportFailure(observer, request, `a3-${index}`, error);
      expect(events[index]).toMatchObject({
        action: `${actionBase}.failed`,
        tableName,
        recordId,
        reason: "VALIDATION_ERROR",
        requestId: `a3-${index}`,
      });
    }

    expect(events).toHaveLength(16);
    expect(JSON.stringify(events)).not.toContain(secret);
  });

  test("registered read can produce one successful outcome before disclosure", async () => {
    const events: AuditEvent[] = [];
    const observer = createObserver(events);
    const resolved = resolveRegisteredA3Action(
      new Request("http://test/api/v1/employees/11"),
    );
    expect(resolved).not.toBeNull();
    const { registration, match } = resolved!;
    const value = await observer.observeRead(
      createActionContext({
        requestId: "a3-read",
        actionBase: registration.actionBase,
        target: {
          tableName: registration.tableName,
          recordId: registration.recordId(match),
        },
      }),
      async () => ({ employee_code: "E011" }),
    );

    expect(value).toEqual({ employee_code: "E011" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "employee.profile.read.succeeded",
      recordId: "11",
    });
  });

  test("sanitizes malformed route IDs while still auditing their failed actions", () => {
    for (const path of [
      "/api/v1/employees/0",
      "/api/v1/employees/not-an-id",
      "/api/v1/employees/9007199254740992",
      "/api/v1/employees/1/bank-accounts/0",
    ]) {
      const method = path.includes("bank-accounts") ? "PATCH" : "GET";
      const resolved = resolveRegisteredA3Action(
        new Request(`http://test${path}`, { method }),
      );
      expect(resolved).not.toBeNull();
      expect(resolved!.registration.recordId(resolved!.match)).toBe("unknown");
    }
  });

  test("ignores preflight, DELETE, unknown paths, and other features", () => {
    for (const request of [
      new Request("http://test/api/v1/employees", { method: "OPTIONS" }),
      new Request("http://test/api/v1/employees/1", { method: "DELETE" }),
      new Request("http://test/api/v1/branches"),
      new Request("http://test/healthz"),
    ])
      expect(resolveRegisteredA3Action(request)).toBeNull();
  });

  test("exported plugin records one framework-validation failure without request body", async () => {
    const events: AuditEvent[] = [];
    const observer = createObserver(events);
    const app = new Elysia()
      .use(createA3TransportAuditPlugin(observer))
      .post("/api/v1/employees/11/bank-accounts", () => ({ ok: true }), {
        body: t.Object({ account_number: t.String(), bank_name: t.String() }),
      });

    const secret = "1234567890123456";
    const response = await app.handle(
      new Request("http://test/api/v1/employees/11/bank-accounts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "a3-validation",
        },
        body: JSON.stringify({ account_number: secret }),
      }),
    );

    expect(response.status).toBe(422);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "employee.bank.create.failed",
      tableName: "employee_bank_accounts",
      recordId: "11",
      requestId: "a3-validation",
    });
    expect(JSON.stringify(events)).not.toContain(secret);
  });
});
