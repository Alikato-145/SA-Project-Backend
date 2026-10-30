import { expect, test } from "bun:test";
import { normalizePromptpayPhone } from "./employee.payment-destination";

test("canonicalizes only Thai mobile recipients and common separators", () => {
  for (const phone of ["0812345678", "081-234-5678", "+66 (81) 234 5678"]) expect(normalizePromptpayPhone(phone)).toBe("0812345678");
  expect(normalizePromptpayPhone(null)).toBeNull();
  for (const phone of ["abc0812345678", "0212345678", "+660812345678", "08123456789", "081/234/5678", ""]) expect(() => normalizePromptpayPhone(phone)).toThrow();
});

import { ActionObserver } from "../../core/audit/action-observer";
import { DomainAuditObserver } from "../../core/audit/domain-audit-observer";
import type { DatabaseExecutor } from "../../core/db/transaction";
import { createEmployeeService } from "./employee.service";
import { createEmployeeReadTestApp, employeeTestActor } from "./employee.test-support";
import type { AuthenticatedActor } from "../../core/auth/auth.types";

test.each(["service", "route"])("%s destination requires current valid grants before lookup, including after last grant revocation", async (boundary) => {
  let reads = 0;
  const executor = {} as DatabaseExecutor;
  const actions = new ActionObserver(executor, { async insert(_executor, event) { return { id: 1, action: event.action, requestId: event.requestId }; } });
  const service = createEmployeeService({ rootExecutor: executor, payroll: { async serialize() {} }, actions,
    paymentRepository: { async findPaymentDestination() { reads++; return { paymentMethod: "transfer", promptpayPhone: "0812345678" }; }, async updatePaymentDestination() { throw new Error("read only"); } },
  });
  let current: AuthenticatedActor = employeeTestActor("EMPLOYEE");
  const app = createEmployeeReadTestApp({ service, actions, authenticate: async () => current });
  const get = () => app.handle(new Request("http://localhost/api/v1/employees/1/payment-destination"));
  for (const role of ["EMPLOYEE", "SUPERVISOR", "BRANCH_MANAGER", "HR", "OWNER"] as const) {
    current = { ...employeeTestActor(role), employeeId: role === "HR" || role === "OWNER" ? null : "1" };
    expect((await get()).status).toBe(200);
  }
  const valid = employeeTestActor("EMPLOYEE");
  const denied = [
    { ...valid, grants: [] },
    { ...valid, grants: [{ ...valid.grants[0]!, roleActive: false }] },
    { ...valid, grants: [{ ...valid.grants[0]!, branchId: "10" }] },
    { ...valid, grants: [{ ...valid.grants[0]!, scope: "branch" }] },
    { ...employeeTestActor("SUPERVISOR"), employeeId: "1", grants: [{ ...employeeTestActor("SUPERVISOR").grants[0]!, departmentId: null }] },
  ] as unknown as AuthenticatedActor[];
  for (const actor of denied) {
    current = actor;
    const before = reads;
    if (boundary === "service") {
      await expect(service.getPaymentDestination({ actor, employeeId: "1", requestId: "invalid-grant" })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
    } else {
      const response = await get();
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN_SCOPE" } });
    }
    expect(reads).toBe(before);
  }
  current = valid;
  expect((await get()).status).toBe(200);
  current = { ...valid, grants: [] }; // Same authenticated account, final grant removed.
  const before = reads;
  expect((await get()).status).toBe(403);
  expect(reads).toBe(before);
  current = { ...valid, employeeId: "2" };
  expect((await get()).status).toBe(403);
  expect(reads).toBe(before);
});

test("destination has separate contact state; self and HR/OWNER write, other employees are denied", async () => {
  const executor = {} as DatabaseExecutor;
  let destination: import("./employee.payment-destination").EmployeePaymentDestination = { paymentMethod: "cash", promptpayPhone: null };
  const events: unknown[] = [];
  const writer = { async insert(_executor: DatabaseExecutor, event: import("../audit/audit.repository").AuditEvent) { events.push(event); return { id: events.length, action: event.action, requestId: event.requestId }; } };
  const service = createEmployeeService({ rootExecutor: executor, payroll: { async serialize() {} },
    transactionRunner: { async transaction(work) { return work(executor as never); } },
    actions: new ActionObserver(executor, writer, { error() {} }), domain: new DomainAuditObserver(writer),
    paymentRepository: { async findPaymentDestination(_executor, id) { return id === "1" ? destination : null; }, async updatePaymentDestination(_executor, _id, input) { destination = { ...destination, ...input }; return destination; } },
  });
  for (const role of ["BRANCH_MANAGER", "SUPERVISOR"] as const) {
    await expect(service.updatePaymentDestination({ actor: employeeTestActor(role), requestId: "deny", employeeId: "1", paymentMethod: "transfer", promptpayPhone: "0812345678" })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
  }
  await service.updatePaymentDestination({ actor: employeeTestActor("EMPLOYEE"), requestId: "own-save", employeeId: "1", paymentMethod: "transfer", promptpayPhone: "0812345678" });
  await expect(service.updatePaymentDestination({ actor: { ...employeeTestActor("EMPLOYEE"), grants: [] }, requestId: "revoked", employeeId: "1", paymentMethod: "cash", promptpayPhone: null })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
  await expect(service.updatePaymentDestination({ actor: employeeTestActor("EMPLOYEE"), requestId: "deny-other", employeeId: "2", paymentMethod: "cash", promptpayPhone: null })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
  for (const role of ["HR", "OWNER"] as const) await service.updatePaymentDestination({ actor: employeeTestActor(role), requestId: "save", employeeId: "1", paymentMethod: "transfer", promptpayPhone: "+66 81-234-5678" });
  expect(await service.getPaymentDestination({ actor: employeeTestActor("EMPLOYEE"), requestId: "own", employeeId: "1" })).toEqual({ paymentMethod: "transfer", promptpayPhone: "0812345678" });
  await expect(service.getPaymentDestination({ actor: employeeTestActor("EMPLOYEE"), requestId: "other", employeeId: "2" })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
  await expect(service.getPaymentDestination({ actor: employeeTestActor("BRANCH_MANAGER"), requestId: "other", employeeId: "1" })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
  await service.updatePaymentDestination({ actor: employeeTestActor("HR"), requestId: "cash", employeeId: "1", paymentMethod: "cash", promptpayPhone: null });
  expect(destination).toEqual({ paymentMethod: "cash", promptpayPhone: null });
  await service.updatePaymentDestination({ actor: employeeTestActor("HR"), requestId: "social", employeeId: "1", paymentMethod: "transfer", paymentCategory: "social_security", promptpayPhone: null });
  await service.updatePaymentDestination({ actor: employeeTestActor("HR"), requestId: "legacy-same-method", employeeId: "1", paymentMethod: "transfer", promptpayPhone: "0812345678" });
  expect(destination.paymentCategory).toBe("social_security");
  await service.updatePaymentDestination({ actor: employeeTestActor("HR"), requestId: "legacy-client", employeeId: "1", paymentMethod: "cash", promptpayPhone: null });
  expect(destination).toEqual({ paymentMethod: "cash", paymentCategory: "cash", promptpayPhone: null });
  expect(JSON.stringify(events)).not.toContain("0812345678");
});
