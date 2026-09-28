import { afterEach, describe, expect, test } from "bun:test";
import { ActionObserver } from "../../core/audit/action-observer";
import { DomainAuditObserver } from "../../core/audit/domain-audit-observer";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { DatabaseExecutor } from "../../core/db/transaction";
import type { AuditEvent } from "../audit/audit.repository";
import { payslipRepository, type PayslipRow } from "./payslip.repository";
import { createPayslipService } from "./payslip.service";

const hr: AuthenticatedActor = {
  accountId: "9",
  employeeId: null,
  username: "hr",
  grants: [{ grantId: "1", roleCode: "HR", scope: "all", branchId: null, departmentId: null }],
};
const employee: AuthenticatedActor = {
  accountId: "8",
  employeeId: "1",
  username: "employee",
  grants: [{ grantId: "2", roleCode: "EMPLOYEE", scope: "self", branchId: null, departmentId: null }],
};
const originalRepository = { ...payslipRepository };
const row = (overrides: Partial<PayslipRow> = {}): PayslipRow => ({
  id: "101",
  payrollRecordId: "99",
  employeeId: "2",
  status: "generated",
  generatedAt: new Date("2026-09-28T00:00:00.000Z"),
  netPay: "1000.00",
  totalEarnings: "1200.00",
  totalDeductions: "200.00",
  fileStorageKey: "payslips/99.json",
  fileSha256: "hash",
  ...overrides,
});

afterEach(() => Object.assign(payslipRepository, originalRepository));

const service = () => {
  const writer = {
    async insert(_executor: DatabaseExecutor, event: AuditEvent) {
      return { id: 1, action: event.action, requestId: event.requestId };
    },
  };
  return createPayslipService({
    rootExecutor: {} as DatabaseExecutor,
    transactionRunner: { async transaction(work) { return work({} as never); } },
    actions: new ActionObserver({} as DatabaseExecutor, writer),
    domain: new DomainAuditObserver(writer),
  });
};

describe("payslip service", () => {
  test("maps the payroll-record uniqueness violation to a duplicate conflict", async () => {
    let inserts = 0;
    payslipRepository.findLockedRecord = async () => ({ id: "99", employeeId: "2", netPay: "1000.00", totalEarnings: "1200.00", totalDeductions: "200.00" });
    payslipRepository.insert = async () => {
      inserts += 1;
      if (inserts > 1) throw Object.assign(new Error("duplicate"), { code: "23505" });
      return "101";
    };
    payslipRepository.find = async () => row();

    expect((await service().generate(hr, "99", "payslip-create")).id).toBe("101");
    await expect(service().generate(hr, "99", "payslip-duplicate")).rejects.toMatchObject({ code: "STATE_CONFLICT" });
  });

  test("denies an employee reading another employee's payslip", async () => {
    payslipRepository.find = async () => row({ employeeId: "2" });

    await expect(service().get(employee, "101", "payslip-cross-employee")).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
  });

  test("appends each delivery attempt without replacing prior attempts", async () => {
    const deliveries: { id: string; recipientEmail: string; status: "sent"; attemptedAt: Date }[] = [];
    payslipRepository.find = async () => row();
    payslipRepository.addDelivery = async (_executor, _payslipId, recipientEmail) => {
      const delivery = { id: String(deliveries.length + 1), recipientEmail, status: "sent" as const, attemptedAt: new Date(`2026-09-28T00:00:0${deliveries.length}.000Z`) };
      deliveries.push(delivery);
      return delivery;
    };
    payslipRepository.listDeliveries = async () => deliveries;

    await service().deliver(hr, "101", "first@example.test", "delivery-1");
    await service().deliver(hr, "101", "second@example.test", "delivery-2");

    expect(await service().deliveries(hr, "101", "delivery-list")).toMatchObject([
      { id: "1", recipient_email: "first@example.test", status: "sent" },
      { id: "2", recipient_email: "second@example.test", status: "sent" },
    ]);
    expect(deliveries).toHaveLength(2);
  });
});
