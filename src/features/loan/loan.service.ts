import type { CreateLoanCommand, LoanActor } from "./loan.dto";
import { LoanError, type LoanRepository } from "./loan.repository";

export type LoanAccess = {
  assertCanCreate(actor: LoanActor, employeeId: number): Promise<void>;
  assertCanRead(actor: LoanActor, employeeId: number): Promise<void>;
};
export type LoanPayrollLock = {
  assertPayrollLocked(transaction: unknown, payrollRecordId: number,
    employeeId: number, duePeriodStart: string): Promise<void>;
};
const cents = (value: string) => {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new LoanError("LOAN_INVALID_INSTALLMENTS");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
};
const money = (amount: bigint) => `${amount / 100n}.${String(amount % 100n).padStart(2, "0")}`;
export const splitInstallments = (principal: string, count: number): string[] => {
  if (!Number.isInteger(count) || count < 1 || count > 5) throw new LoanError("LOAN_INVALID_INSTALLMENTS");
  const total = cents(principal);
  if (total < BigInt(count)) throw new LoanError("LOAN_INVALID_INSTALLMENTS");
  const base = total / BigInt(count);
  const extra = total % BigInt(count);
  return Array.from({ length: count }, (_, index) =>
    money(base + (BigInt(index) < extra ? 1n : 0n)));
};
const dueMonth = (first: string, offset: number) => {
  if (!/^\d{4}-\d{2}-01$/.test(first)) throw new LoanError("LOAN_INVALID_INSTALLMENTS");
  const date = new Date(`${first}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== first) {
    throw new LoanError("LOAN_INVALID_INSTALLMENTS");
  }
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1))
    .toISOString().slice(0, 10);
};
export class LoanService {
  constructor(
    private readonly repository: LoanRepository,
    private readonly access: LoanAccess,
    private readonly payrollLock: LoanPayrollLock,
  ) {}
  async createLoan(actor: LoanActor, command: CreateLoanCommand) {
    const amounts = splitInstallments(command.principalAmount, command.installmentCount);
    if (!command.reason.trim()) throw new LoanError("LOAN_INVALID_INSTALLMENTS");
    await this.access.assertCanCreate(actor, command.employeeId);
    return this.repository.create({ ...command, approvedByUserAccountId: actor.accountId },
      amounts.map((amount, index) => ({
        amount, installmentNo: index + 1, duePeriodStart: dueMonth(command.firstDueMonth, index),
      })));
  }
  async listLoans(actor: LoanActor, employeeId: number) {
    await this.access.assertCanRead(actor, employeeId);
    return this.repository.listByEmployee(employeeId);
  }
  async findDueForPayroll(actor: LoanActor, employeeId: number, periodStart: string) {
    dueMonth(periodStart, 0);
    await this.access.assertCanRead(actor, employeeId);
    return this.repository.findDue(employeeId, periodStart);
  }
  async markDeducted(actor: LoanActor, installmentId: number, payrollRecordId: number, transaction: unknown) {
    const found = await this.repository.findInstallmentById(installmentId);
    if (!found) throw new LoanError("LOAN_NOT_FOUND");
    await this.access.assertCanRead(actor, found.employeeId);
    if (found.installment.status !== "scheduled") throw new LoanError("LOAN_ALREADY_DEDUCTED");
    await this.payrollLock.assertPayrollLocked(transaction, payrollRecordId,
      found.employeeId, found.installment.duePeriodStart);
    return this.repository.settleInstallment(transaction, installmentId, payrollRecordId);
  }
}
