import { and, eq, inArray, lte } from "drizzle-orm";
import { db } from "../../core/db/client";
import { loanInstallments, loans } from "./loan.schema";
import type { CreateLoanCommand, LoanInstallment, LoanWithInstallments } from "./loan.dto";

export class LoanError extends Error {
  constructor(public readonly code:
    | "LOAN_INVALID_INSTALLMENTS" | "LOAN_NOT_FOUND" | "LOAN_ALREADY_DEDUCTED"
    | "OUT_OF_SCOPE" | "PAYROLL_PERIOD_NOT_LOCKED") {
    super(code); this.name = "LoanError";
  }
}
type Schedule = { installmentNo: number; duePeriodStart: string; amount: string };
export type LoanRepository = {
  create(command: CreateLoanCommand & { approvedByUserAccountId: number }, schedule: Schedule[]): Promise<LoanWithInstallments>;
  listByEmployee(employeeId: number): Promise<LoanWithInstallments[]>;
  findDue(employeeId: number, periodStart: string): Promise<LoanInstallment[]>;
  findInstallmentById(id: number): Promise<{ installment: LoanInstallment; employeeId: number } | undefined>;
  settleInstallment(transaction: unknown, id: number, payrollRecordId: number): Promise<LoanInstallment>;
};
export class DrizzleLoanRepository implements LoanRepository {
  async create(command: CreateLoanCommand & { approvedByUserAccountId: number }, schedule: Schedule[]): Promise<LoanWithInstallments> {
    return db.transaction(async (tx) => {
      const [loan] = await tx.insert(loans).values({
        employeeId: command.employeeId, principalAmount: command.principalAmount,
        installmentCount: command.installmentCount, reason: command.reason,
        approvedByUserAccountId: command.approvedByUserAccountId, approvedAt: new Date(),
      }).returning();
      const installments = await tx.insert(loanInstallments).values(schedule.map((row) => ({
        loanId: loan.id, installmentNo: row.installmentNo,
        duePeriodStart: row.duePeriodStart, amount: row.amount,
      }))).returning();
      return { loan, installments };
    });
  }
  async listByEmployee(employeeId: number): Promise<LoanWithInstallments[]> {
    const rows = await db.query.loans.findMany({ where: eq(loans.employeeId, employeeId) });
    if (!rows.length) return [];
    const installments = await db.query.loanInstallments.findMany({
      where: inArray(loanInstallments.loanId, rows.map((row) => row.id)),
    });
    return rows.map((loan) => ({ loan, installments: installments.filter((row) => row.loanId === loan.id) }));
  }
  async findDue(employeeId: number, periodStart: string): Promise<LoanInstallment[]> {
    const rows = await db.select({ installment: loanInstallments }).from(loanInstallments)
      .innerJoin(loans, eq(loanInstallments.loanId, loans.id))
      .where(and(eq(loans.employeeId, employeeId),
        eq(loanInstallments.status, "scheduled"),
        lte(loanInstallments.duePeriodStart, periodStart)));
    return rows.map((row) => row.installment);
  }
  async findInstallmentById(id: number) {
    const [row] = await db.select({ installment: loanInstallments, employeeId: loans.employeeId })
      .from(loanInstallments).innerJoin(loans, eq(loanInstallments.loanId, loans.id))
      .where(eq(loanInstallments.id, id));
    return row;
  }
  async settleInstallment(transaction: unknown, id: number, payrollRecordId: number): Promise<LoanInstallment> {
    const tx = transaction as typeof db;
    const [row] = await tx.update(loanInstallments).set({
      status: "deducted", payrollRecordId, deductedAt: new Date(), updatedAt: new Date(),
    }).where(and(eq(loanInstallments.id, id), eq(loanInstallments.status, "scheduled"))).returning();
    if (!row) throw new LoanError("LOAN_ALREADY_DEDUCTED");
    return row;
  }
}
