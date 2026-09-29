import { describe, expect, test } from "bun:test";
import {
  A1_ACTION_REGISTRY,
  observeA1TransportFailure,
  resolveRegisteredA1Action,
} from "../../core/audit/a1-transport-audit.plugin";
import {
  A2_ACTION_REGISTRY,
  observeA2TransportFailure,
  resolveRegisteredA2Action,
} from "../../core/audit/a2-transport-audit.plugin";
import {
  A3_ACTION_REGISTRY,
  observeA3TransportFailure,
  resolveRegisteredA3Action,
} from "../../core/audit/a3-transport-audit.plugin";
import { ActionObserver } from "../../core/audit/action-observer";
import {
  accountAuditSnapshot,
  bankAccountAuditSnapshot,
  branchAuditSnapshot,
  roleGrantAuditSnapshot,
} from "../../core/audit/audit-redaction";
import { ApplicationError } from "../../core/errors/application.error";
import {
  assignmentAuditSnapshot,
  employeeAuditSnapshot,
  weeklyHolidayAuditSnapshot,
} from "../employee/employee.types";
import type { AuditEvent, AuditReceipt } from "./audit.repository";

const cases = [
  ["POST", "/api/v1/auth/login", "authentication.session.login"],
  ["POST", "/api/v1/auth/logout", "authentication.session.logout"],
  ["GET", "/api/v1/auth/me", "authentication.session.view"],
  ["GET", "/api/v1/accounts", "account.catalog.list"],
  ["POST", "/api/v1/accounts", "account.profile.create"],
  ["GET", "/api/v1/accounts/9", "account.profile.read"],
  ["PATCH", "/api/v1/accounts/9/status", "account.status.change"],
  ["POST", "/api/v1/accounts/9/reset-password", "account.credential.reset"],
  ["POST", "/api/v1/accounts/9/unlock", "account.lock.unlock"],
  ["GET", "/api/v1/roles", "role.catalog.read"],
  ["POST", "/api/v1/accounts/9/roles", "role.grant.create"],
  ["DELETE", "/api/v1/accounts/9/roles/31", "role.grant.revoke"],
  ["GET", "/api/v1/audit-logs", "audit.history.list"],
  ["GET", "/api/v1/shops", "organization.shop.list"],
  ["POST", "/api/v1/shops", "organization.shop.create"],
  ["GET", "/api/v1/shops/9", "organization.shop.read"],
  ["PATCH", "/api/v1/shops/9", "organization.shop.update"],
  ["POST", "/api/v1/shops/9/deactivate", "organization.shop.deactivate"],
  ["GET", "/api/v1/branches", "organization.branch.list"],
  ["POST", "/api/v1/branches", "organization.branch.create"],
  ["GET", "/api/v1/branches/9", "organization.branch.read"],
  ["PATCH", "/api/v1/branches/9", "organization.branch.update"],
  ["POST", "/api/v1/branches/9/deactivate", "organization.branch.deactivate"],
  ["GET", "/api/v1/departments", "organization.department.list"],
  ["POST", "/api/v1/departments", "organization.department.create"],
  ["GET", "/api/v1/departments/9", "organization.department.read"],
  ["PATCH", "/api/v1/departments/9", "organization.department.update"],
  ["POST", "/api/v1/departments/9/deactivate", "organization.department.deactivate"],
  ["GET", "/api/v1/positions", "organization.position.list"],
  ["POST", "/api/v1/positions", "organization.position.create"],
  ["GET", "/api/v1/positions/9", "organization.position.read"],
  ["PATCH", "/api/v1/positions/9", "organization.position.update"],
  ["POST", "/api/v1/positions/9/deactivate", "organization.position.deactivate"],
  ["GET", "/api/v1/employees", "employee.profile.list"],
  ["POST", "/api/v1/employees", "employee.profile.create"],
  ["GET", "/api/v1/employees/9", "employee.profile.read"],
  ["PATCH", "/api/v1/employees/9", "employee.profile.update"],
  ["PATCH", "/api/v1/employees/9/status", "employee.status.change"],
  ["POST", "/api/v1/employees/onboard", "employee.profile.onboard"],
  ["GET", "/api/v1/employees/9/assignments", "employee.assignment.list"],
  ["POST", "/api/v1/employees/9/assignments", "employee.assignment.create"],
  ["GET", "/api/v1/employees/9/bank-accounts", "employee.bank.list"],
  ["POST", "/api/v1/employees/9/bank-accounts", "employee.bank.create"],
  ["PATCH", "/api/v1/employees/9/bank-accounts/31", "employee.bank.update"],
  ["POST", "/api/v1/employees/9/bank-accounts/31/make-primary", "employee.bank.make-primary"],
  ["POST", "/api/v1/employees/9/bank-accounts/31/deactivate", "employee.bank.deactivate"],
  ["GET", "/api/v1/employees/9/weekly-holidays", "employee.holiday.list"],
  ["POST", "/api/v1/employees/9/weekly-holidays", "employee.holiday.create"],
  ["POST", "/api/v1/employees/9/weekly-holidays/31/end", "employee.holiday.end"],
] as const;

const registries = [A1_ACTION_REGISTRY, A2_ACTION_REGISTRY, A3_ACTION_REGISTRY];
const resolvers = [resolveRegisteredA1Action, resolveRegisteredA2Action, resolveRegisteredA3Action];
const observeFailures = [observeA1TransportFailure, observeA2TransportFailure, observeA3TransportFailure];

describe("A5 Person A audit integration matrix", () => {
  test("every registered public action has exactly one owner and a canonical failure audit", async () => {
    expect(registries.reduce((count, registry) => count + registry.length, 0)).toBe(cases.length);
    const events: AuditEvent[] = [];
    const observer = new ActionObserver({} as never, {
      async insert(_executor: never, event: AuditEvent): Promise<AuditReceipt> {
        events.push(event);
        return { id: events.length, action: event.action, requestId: event.requestId };
      },
    } as never);

    for (const [index, [method, path, actionBase]] of cases.entries()) {
      const request = new Request(`http://test${path}`, { method });
      const matches = resolvers.flatMap((resolve, owner) => {
        const resolved = resolve(request);
        return resolved ? [{ owner, resolved }] : [];
      });
      expect(matches).toHaveLength(1);
      expect(matches[0]?.resolved.registration.actionBase).toBe(actionBase);

      const error = new ApplicationError("FORBIDDEN_SCOPE");
      const observe = observeFailures[matches[0]!.owner]!;
      await observe(observer, request, `a5-audit-${index}`, error);
      await observe(observer, request, `a5-audit-${index}`, error);
      expect(events[index]).toMatchObject({
        action: `${actionBase}.failed`,
        requestId: `a5-audit-${index}`,
        reason: "FORBIDDEN_SCOPE",
      });
    }
    expect(events).toHaveLength(cases.length);
    expect(new Set(events.map((event) => event.action)).size).toBe(cases.length);
  });

  test("A1-A3 audit snapshots never persist identity, credential, or full bank secrets", () => {
    const unsafe = {
      password: "secret-password-a5",
      password_hash: "secret-hash-a5",
      token: "secret-token-a5",
      national_id: "secret-national-a5",
      account_number: "secret-bank-a5",
      account_number_ciphertext: "secret-cipher-a5",
    };
    const snapshots = [
      accountAuditSnapshot({ id: "1", username: "employee", ...unsafe }),
      roleGrantAuditSnapshot({ id: "2", role_id: "3", ...unsafe }),
      branchAuditSnapshot({ id: "4", name: "West", ...unsafe }),
      employeeAuditSnapshot({ id: "5", employee_code: "EMP-5", ...unsafe }),
      assignmentAuditSnapshot({ id: "6", branch_id: "4", base_salary: "15000.00", ...unsafe }),
      bankAccountAuditSnapshot({ id: "7", account_number_last4: "3456", ...unsafe }),
      weeklyHolidayAuditSnapshot({ id: "8", weekday: 0, ...unsafe }),
    ];
    const serialized = JSON.stringify(snapshots);
    for (const secret of Object.values(unsafe)) expect(serialized).not.toContain(secret);
    expect(serialized).toContain("15000.00");
    expect(serialized).toContain("3456");
  });

  test("A1/A2 malformed long route IDs still produce bounded failure audits", async () => {
    const events: AuditEvent[] = [];
    const observer = new ActionObserver({} as never, {
      async insert(_executor: never, event: AuditEvent): Promise<AuditReceipt> {
        events.push(event);
        return { id: events.length, action: event.action, requestId: event.requestId };
      },
    } as never);
    const oversized = "9".repeat(101);
    const requests = [
      new Request(`http://test/api/v1/accounts/${oversized}`),
      new Request(`http://test/api/v1/shops/${oversized}`),
    ];
    await observeA1TransportFailure(observer, requests[0]!, "a5-long-a1", new ApplicationError("VALIDATION_ERROR"));
    await observeA2TransportFailure(observer, requests[1]!, "a5-long-a2", new ApplicationError("VALIDATION_ERROR"));
    expect(events.map((event) => event.recordId)).toEqual(["unknown", "unknown"]);
    expect(events.map((event) => event.action)).toEqual(["account.profile.read.failed", "organization.shop.read.failed"]);
  });
});
