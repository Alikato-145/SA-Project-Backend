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
import { employeeTestActor } from "./employee.test-support";

test("destination has separate contact state; only HR/OWNER writes and self reads", async () => {
  const executor = {} as DatabaseExecutor;
  let destination = { paymentMethod: "cash" as "cash" | "transfer", promptpayPhone: null as string | null };
  const events: unknown[] = [];
  const writer = { async insert(_executor: DatabaseExecutor, event: import("../audit/audit.repository").AuditEvent) { events.push(event); return { id: events.length, action: event.action, requestId: event.requestId }; } };
  const service = createEmployeeService({ rootExecutor: executor, payroll: { async serialize() {} },
    transactionRunner: { async transaction(work) { return work(executor as never); } },
    actions: new ActionObserver(executor, writer, { error() {} }), domain: new DomainAuditObserver(writer),
    paymentRepository: { async findPaymentDestination(_executor, id) { return id === "1" ? destination : null; }, async updatePaymentDestination(_executor, _id, input) { destination = input; return input; } },
  });
  for (const role of ["EMPLOYEE", "BRANCH_MANAGER", "SUPERVISOR"] as const) {
    await expect(service.updatePaymentDestination({ actor: employeeTestActor(role), requestId: "deny", employeeId: "1", paymentMethod: "transfer", promptpayPhone: "0812345678" })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
  }
  for (const role of ["HR", "OWNER"] as const) await service.updatePaymentDestination({ actor: employeeTestActor(role), requestId: "save", employeeId: "1", paymentMethod: "transfer", promptpayPhone: "+66 81-234-5678" });
  expect(await service.getPaymentDestination({ actor: employeeTestActor("EMPLOYEE"), requestId: "own", employeeId: "1" })).toEqual({ paymentMethod: "transfer", promptpayPhone: "0812345678" });
  await expect(service.getPaymentDestination({ actor: employeeTestActor("EMPLOYEE"), requestId: "other", employeeId: "2" })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
  await expect(service.getPaymentDestination({ actor: employeeTestActor("BRANCH_MANAGER"), requestId: "other", employeeId: "1" })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
  await service.updatePaymentDestination({ actor: employeeTestActor("HR"), requestId: "cash", employeeId: "1", paymentMethod: "cash", promptpayPhone: null });
  expect(destination).toEqual({ paymentMethod: "cash", promptpayPhone: null });
  expect(JSON.stringify(events)).not.toContain("0812345678");
});
