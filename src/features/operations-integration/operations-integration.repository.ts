import { and, eq, gte, lte, or, isNull, sql } from "drizzle-orm";
import { db } from "../../core/db/client";
import { workDayRecords } from "../attendance/attendance.schema";
import { branches } from "../branch/branch.schema";
import { debtTransactions } from "../debt/debt.schema";
import { employmentAssignments } from "../employment-assignment/employment-assignment.schema";
import { loanInstallments, loans } from "../loan/loan.schema";
import { payrollPeriods, payrollRecords } from "../payroll/payroll.schema";
import type { OperationAssignment, OperationsScopeRepository } from "./operations-integration.service";

export class DrizzleOperationsScopeRepository implements OperationsScopeRepository {
  async assignmentAt(employeeId: number, date: string): Promise<OperationAssignment | undefined> {
    const [row] = await db.select({ branchId: employmentAssignments.branchId, departmentId: employmentAssignments.departmentId })
      .from(employmentAssignments)
      .where(and(eq(employmentAssignments.employeeId, employeeId), lte(employmentAssignments.effectiveFrom, date),
        or(isNull(employmentAssignments.effectiveTo), gte(employmentAssignments.effectiveTo, date))))
      .limit(1);
    return row;
  }

  async branchShopId(branchId: number) {
    const [row] = await db.select({ shopId: branches.shopId }).from(branches).where(eq(branches.id, branchId)).limit(1);
    return row?.shopId;
  }

  async payrollLocked(employeeId: number, date: string) {
    const [row] = await db.select({ id: payrollRecords.id }).from(payrollRecords)
      .innerJoin(payrollPeriods, eq(payrollRecords.payrollPeriodId, payrollPeriods.id))
      .where(and(eq(payrollRecords.employeeId, employeeId), eq(payrollPeriods.status, "locked"),
        lte(payrollPeriods.startDate, date), gte(payrollPeriods.endDate, date))).limit(1);
    return row !== undefined;
  }

  async workedDays(employeeId: number, startDate: string, endDate: string) {
    const rows = await db.select({ id: workDayRecords.id }).from(workDayRecords).where(and(
      eq(workDayRecords.employeeId, employeeId), gte(workDayRecords.workDate, startDate), lte(workDayRecords.workDate, endDate),
      sql`${workDayRecords.status} in ('present', 'late')`,
    ));
    return rows.length;
  }

  async baseSalary(employeeId: number, date: string) {
    const [row] = await db.select({ baseSalary: employmentAssignments.baseSalary }).from(employmentAssignments)
      .where(and(eq(employmentAssignments.employeeId, employeeId), lte(employmentAssignments.effectiveFrom, date),
        or(isNull(employmentAssignments.effectiveTo), gte(employmentAssignments.effectiveTo, date))))
      .limit(1);
    return row?.baseSalary;
  }

  async projectedNetPay(employeeId: number, monthStart: string, advanceAmount: string) {
    const base = await this.baseSalary(employeeId, monthStart);
    if (!base) return "-1.00";
    const debts = await db.select({ amount: debtTransactions.amount }).from(debtTransactions).where(and(
      eq(debtTransactions.employeeId, employeeId), lte(debtTransactions.transactionDate, `${monthStart.slice(0, 7)}-31`),
      isNull(debtTransactions.settledInPayrollRecordId),
    ));
    const installments = await db.select({ amount: loanInstallments.amount }).from(loanInstallments)
      .innerJoin(loans, eq(loanInstallments.loanId, loans.id))
      .where(and(eq(loans.employeeId, employeeId), eq(loanInstallments.status, "scheduled"), lte(loanInstallments.duePeriodStart, monthStart)));
    const cents = (value: string) => {
      const [whole, fraction = ""] = value.split(".");
      return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
    };
    const total = cents(base) - cents(advanceAmount) - debts.reduce((sum, row) => sum + cents(row.amount), 0n)
      - installments.reduce((sum, row) => sum + cents(row.amount), 0n);
    return `${total < 0n ? "-" : ""}${(total < 0n ? -total : total) / 100n}.${String((total < 0n ? -total : total) % 100n).padStart(2, "0")}`;
  }

  async overtimeEligible(employeeId: number, date: string, type: "hourly" | "rest_day" | "public_holiday", workDayRecordId?: number | null) {
    const rows = await db.select().from(workDayRecords).where(and(eq(workDayRecords.employeeId, employeeId), eq(workDayRecords.workDate, date),
      workDayRecordId ? eq(workDayRecords.id, workDayRecordId) : undefined)).limit(1);
    const record = rows[0];
    if (!record) return false;
    return type === "hourly" ? ["present", "late"].includes(record.status)
      : type === "rest_day" ? record.status === "weekly_holiday"
        : record.status === "public_holiday";
  }
}
