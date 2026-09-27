import { describe, expect, test } from "bun:test";
import {
  A3_ACTION_REGISTRY,
  resolveRegisteredA3Action,
} from "../../core/audit/a3-transport-audit.plugin";
import { createActionContext } from "../../core/audit/action-context";
import { ActionObserver } from "../../core/audit/action-observer";
import { DomainAuditObserver } from "../../core/audit/domain-audit-observer";
import type { DatabaseExecutor, TransactionRunner } from "../../core/db/transaction";
import type { AuditEvent, AuditReceipt } from "../audit/audit.repository";
import { createA3EmployeeRoutes } from "./employee.routes";

const actionCases = [
  ["GET", "/api/v1/employees", "employee.profile.list"],
  ["POST", "/api/v1/employees", "employee.profile.create"],
  ["GET", "/api/v1/employees/1", "employee.profile.read"],
  ["PATCH", "/api/v1/employees/1", "employee.profile.update"],
  ["PATCH", "/api/v1/employees/1/status", "employee.status.change"],
  ["POST", "/api/v1/employees/onboard", "employee.profile.onboard"],
  ["GET", "/api/v1/employees/1/assignments", "employee.assignment.list"],
  ["POST", "/api/v1/employees/1/assignments", "employee.assignment.create"],
  ["GET", "/api/v1/employees/1/bank-accounts", "employee.bank.list"],
  ["POST", "/api/v1/employees/1/bank-accounts", "employee.bank.create"],
  ["PATCH", "/api/v1/employees/1/bank-accounts/2", "employee.bank.update"],
  ["POST", "/api/v1/employees/1/bank-accounts/2/make-primary", "employee.bank.make-primary"],
  ["POST", "/api/v1/employees/1/bank-accounts/2/deactivate", "employee.bank.deactivate"],
  ["GET", "/api/v1/employees/1/weekly-holidays", "employee.holiday.list"],
  ["POST", "/api/v1/employees/1/weekly-holidays", "employee.holiday.create"],
  ["POST", "/api/v1/employees/1/weekly-holidays/2/end", "employee.holiday.end"],
] as const;

describe("A3 public action audit matrix", () => {
  test("registers every one of the 16 public actions exactly once", () => {
    expect(A3_ACTION_REGISTRY).toHaveLength(16);
    for (const [method, path, actionBase] of actionCases) {
      const resolved = resolveRegisteredA3Action(new Request("http://localhost" + path, { method }));
      expect(resolved?.registration.actionBase).toBe(actionBase);
    }
  });

  test("exports exactly the same 16 public routes and no hard-delete method", () => {
    const app = createA3EmployeeRoutes({
      actions: {} as never,
      service: {} as never,
      assignmentService: {} as never,
      bankAccountService: {} as never,
      weeklyHolidayService: {} as never,
      async authenticate() { throw new Error("not invoked during composition"); },
      allowedOrigins: [],
    });
    const routes = app.routes.map(({ method, path }) => method + " " + path);
    const expected = actionCases.map(([method, path]) => {
      const parameterized = path
        .replace("/1/bank-accounts/2", "/:employee_id/bank-accounts/:bank_account_id")
        .replace("/1/weekly-holidays/2", "/:employee_id/weekly-holidays/:holiday_id")
        .replace("/1/assignments", "/:employee_id/assignments")
        .replace("/1/bank-accounts", "/:employee_id/bank-accounts")
        .replace("/1/weekly-holidays", "/:employee_id/weekly-holidays")
        .replace("/1/status", "/:employee_id/status")
        .replace("/1", "/:employee_id");
      return method + " " + parameterized;
    });
    expect(routes).toHaveLength(16);
    expect(new Set(routes)).toEqual(new Set(expected));
    expect(routes.some((route) => route.startsWith("DELETE "))).toBe(false);
  });

  test("rolls mutation state back when the canonical success audit cannot commit", async () => {
    type State = { rows: string[]; events: AuditEvent[] };
    const root: State = { rows: [], events: [] };
    const runner: TransactionRunner = {
      async transaction(work) {
        const staged = structuredClone(root);
        const result = await work(staged as unknown as never);
        Object.assign(root, staged);
        return result;
      },
    };
    const writer = {
      async insert(executor: DatabaseExecutor, event: AuditEvent): Promise<AuditReceipt> {
        if (event.action.endsWith(".succeeded")) throw new Error("audit unavailable");
        const state = executor as unknown as State;
        state.events.push(event);
        return { id: state.events.length, action: event.action, requestId: event.requestId };
      },
    };
    const actions = new ActionObserver(root as unknown as DatabaseExecutor, writer, { error() {} });
    const domain = new DomainAuditObserver(writer);
    const context = createActionContext({
      requestId: "audit-rollback",
      actionBase: "employee.profile.onboard",
      target: { tableName: "employees", recordId: "unknown" },
    });

    await expect(actions.observeMutation(context, () =>
      runner.transaction(async (executor) => {
        (executor as unknown as State).rows.push("employee-1");
        const receipt = await domain.record(executor, context, {
          newData: { id: "employee-1" },
        });
        return domain.complete("employee-1", receipt);
      }),
    )).rejects.toThrow("audit unavailable");

    expect(root.rows).toEqual([]);
    expect(root.events.map((event) => event.action)).toEqual([
      "employee.profile.onboard.failed",
    ]);
  });
});
