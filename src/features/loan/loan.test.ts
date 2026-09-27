import { describe, expect, test } from "bun:test";
import { LoanError, type LoanRepository } from "./loan.repository";
import { LoanService, splitInstallments } from "./loan.service";
import type { Loan, LoanInstallment } from "./loan.dto";
import { toLoanResponse } from "./loan.mapper";

const loan: Loan = {
  id: 1, employeeId: 10, principalAmount: "100.01", reason: "Emergency",
  installmentCount: 3, status: "active", approvedByUserAccountId: 2,
  approvedAt: new Date(), closedAt: null, createdAt: new Date(), updatedAt: new Date(),
};
const installment: LoanInstallment = {
  id: 3, loanId: 1, installmentNo: 1, duePeriodStart: "2026-10-01", amount: "33.34",
  status: "scheduled", deductedAt: null, payrollRecordId: null,
  createdAt: new Date(), updatedAt: new Date(),
};
const fixture = () => {
  let settled = false;
  const repository: LoanRepository = {
    async create(_command, rows) {
      expect(rows.map((row) => row.amount)).toEqual(["33.34", "33.34", "33.33"]);
      return { loan, installments: rows.map((row, index) => ({ ...installment, ...row, id: index + 1 })) };
    },
    async listByEmployee() { return [{ loan, installments: [installment] }]; },
    async findDue() { return [installment]; },
    async findInstallmentById() { return {
      installment: settled ? { ...installment, status: "deducted" } as LoanInstallment : installment,
      employeeId: 10,
    }; },
    async settleInstallment() {
      if (settled) throw new LoanError("LOAN_ALREADY_DEDUCTED");
      settled = true; return { ...installment, status: "deducted", payrollRecordId: 5 };
    },
  };
  const access = { async assertCanCreate() {}, async assertCanRead() {} };
  const lock = { async assertPayrollLocked(_tx: unknown, payrollRecordId: number,
    employeeId: number, duePeriodStart: string) {
    expect([payrollRecordId, employeeId, duePeriodStart]).toEqual([5, 10, "2026-10-01"]);
  } };
  return { service: new LoanService(repository, access, lock), access };
};
describe("loan installments", () => {
  test("allocates remainder cents to earliest installments", () => {
    expect(splitInstallments("100.01", 3)).toEqual(["33.34", "33.34", "33.33"]);
    expect(splitInstallments("0.05", 5)).toEqual(["0.01", "0.01", "0.01", "0.01", "0.01"]);
  });
  test("rejects invalid count and zero-cent installments", () => {
    for (const [principal, count] of [["100", 6], ["0.03", 5], ["0", 1]] as const) {
      expect(() => splitInstallments(principal, count)).toThrow(LoanError);
    }
  });
  test("creates a dated exact schedule", async () => {
    const result = await fixture().service.createLoan({ accountId: 2 }, {
      employeeId: 10, principalAmount: "100.01", installmentCount: 3,
      firstDueMonth: "2026-10-01", reason: "Emergency",
    });
    expect(result.installments.map((row) => row.duePeriodStart)).toEqual([
      "2026-10-01", "2026-11-01", "2026-12-01",
    ]);
  });
  test("requires payroll lock and settles only once", async () => {
    const f = fixture();
    expect((await f.service.markDeducted({ accountId: 2 }, 3, 5, {})).status).toBe("deducted");
    await expect(f.service.markDeducted({ accountId: 2 }, 3, 5, {}))
      .rejects.toMatchObject({ code: "LOAN_ALREADY_DEDUCTED" });
  });
  test("shows exact outstanding principal after deducted installments", () => {
    expect(toLoanResponse({ loan, installments: [
      { ...installment, status: "deducted" }, { ...installment, id: 4, amount: "33.34" },
      { ...installment, id: 5, amount: "33.33" },
    ] }).outstandingAmount).toBe("66.67");
  });
});
