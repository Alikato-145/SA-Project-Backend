import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db } from "../../core/db/client";
import type { DatabaseExecutor } from "../../core/db/transaction";
import { advanceRequests } from "../advance/advance.schema";
import { workDayRecords } from "../attendance/attendance.schema";
import { branchScheduleOverrides, branchSchedules } from "../branch-schedule/branch-schedule.schema";
import { debtTransactions } from "../debt/debt.schema";
import { employeeWeeklyHolidays } from "../employee-weekly-holiday/employee-weekly-holiday.schema";
import { employees } from "../employee/employee.schema";
import { employmentAssignments } from "../employment-assignment/employment-assignment.schema";
import { leaveRequestDays, leaveRequests } from "../leave/leave.schema";
import { holidayCalendars } from "../holiday-calendar/holiday-calendar.schema";
import { loanInstallments, loans } from "../loan/loan.schema";
import { overtimeRecords } from "../overtime/overtime.schema";
import { shops } from "../shop/shop.schema";
import {
  payrollAdjustments,
  payrollConfigurations,
  payrollItems,
  payrollPeriods,
  payrollRecords,
} from "./payroll.schema";
import type {
  CreatePayrollConfigurationCommand,
  CreatePayrollPeriodCommand,
  PayrollAdjustmentRecord,
  PayrollCalculatedRecord,
  PayrollConfigurationKey,
  PayrollConfigurationRecord,
  PayrollPeriodRecord,
  PayrollRecordDetail,
  PayrollCalculationInput,
  PayrollBlocker,
} from "./payroll.types";

type Executor = DatabaseExecutor;
const numericId = (value: string) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new RangeError("Unsafe identifier");
  return parsed;
};
const id = (value: number) => String(value);

const toConfiguration = (row: typeof payrollConfigurations.$inferSelect): PayrollConfigurationRecord => ({
  id: id(row.id), shopId: id(row.shopId), branchId: row.branchId === null ? null : id(row.branchId),
  configKey: row.configKey as PayrollConfigurationKey, numericValue: row.numericValue, unit: row.unit,
  effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo,
  createdByUserAccountId: id(row.createdByUserAccountId),
});
const toPeriod = (row: typeof payrollPeriods.$inferSelect): PayrollPeriodRecord => ({
  id: id(row.id), shopId: id(row.shopId), periodYear: row.periodYear, periodMonth: row.periodMonth,
  startDate: row.startDate, endDate: row.endDate, status: row.status,
  createdByUserAccountId: id(row.createdByUserAccountId), previewedAt: row.previewedAt,
  lockedByUserAccountId: row.lockedByUserAccountId === null ? null : id(row.lockedByUserAccountId),
  lockedAt: row.lockedAt,
});

export interface PayrollRepositorySession {
  executor: Executor;
  findActiveShop(id: string): Promise<boolean>;
  findConfigurationOverlap(command: Omit<CreatePayrollConfigurationCommand, "actor" | "requestId">): Promise<boolean>;
  insertConfiguration(command: Omit<CreatePayrollConfigurationCommand, "actor" | "requestId"> & { actorId: string }): Promise<PayrollConfigurationRecord>;
  resolveConfiguration(shopId: string, branchId: string | null, key: PayrollConfigurationKey, date: string, forUpdate?: boolean): Promise<PayrollConfigurationRecord | null>;
  findPeriodByMonth(shopId: string, year: number, month: number): Promise<PayrollPeriodRecord | null>;
  insertPeriod(command: Omit<CreatePayrollPeriodCommand, "actor" | "requestId"> & { actorId: string }): Promise<PayrollPeriodRecord>;
  findPeriod(id: string, forUpdate?: boolean): Promise<PayrollPeriodRecord | null>;
  setPreviewed(id: string): Promise<PayrollPeriodRecord>;
  setLocked(id: string, actorId: string): Promise<PayrollPeriodRecord>;
  replaceCalculatedRecords(periodId: string, records: readonly PayrollCalculatedRecord[], actorId: string, locked: boolean): Promise<void>;
  settleFinanceSources(periodId: string): Promise<void>;
  insertAdjustment(command: { originalRecordId: string; targetPeriodId: string; direction: "earning" | "deduction"; amount: string; reason: string; actorId: string }): Promise<PayrollAdjustmentRecord>;
  findAdjustment(id: string): Promise<PayrollAdjustmentRecord | null>;
  decideAdjustment(id: string, decision: "approved" | "rejected", actorId: string): Promise<PayrollAdjustmentRecord>;
  findRecordState(id: string): Promise<{ status: "draft" | "calculated" | "locked"; branchId: string; periodEnd: string } | null>;
}

export interface PayrollRepository {
  withTransaction<T>(work: (session: PayrollRepositorySession) => Promise<T>): Promise<T>;
  listConfigurations(shopId: string): Promise<PayrollConfigurationRecord[]>;
  listPeriods(shopId: string): Promise<PayrollPeriodRecord[]>;
  findPeriod(id: string): Promise<PayrollPeriodRecord | null>;
  findRecordBranch(recordId: string): Promise<string | null>;
  findRecordDetail(periodId: string, recordId: string): Promise<PayrollRecordDetail | null>;
  listPeriodRecords(periodId: string, branchIds: readonly string[] | null): Promise<PayrollRecordDetail[]>;
  listAdjustments(recordId?: string): Promise<PayrollAdjustmentRecord[]>;
}

const createSession = (executor: Executor): PayrollRepositorySession => ({
  executor,
  async findActiveShop(shopId) {
    const [shop] = await executor.select({ id: shops.id }).from(shops)
      .where(and(eq(shops.id, numericId(shopId)), eq(shops.isActive, true))).limit(1);
    return shop !== undefined;
  },
  async findConfigurationOverlap(command) {
    const rows = await executor.select({ id: payrollConfigurations.id }).from(payrollConfigurations).where(and(
      eq(payrollConfigurations.shopId, numericId(command.shopId)),
      command.branchId === null ? isNull(payrollConfigurations.branchId) : eq(payrollConfigurations.branchId, numericId(command.branchId)),
      eq(payrollConfigurations.configKey, command.configKey),
      or(isNull(payrollConfigurations.effectiveTo), gte(payrollConfigurations.effectiveTo, command.effectiveFrom)),
      command.effectiveTo === null ? sql`true` : lte(payrollConfigurations.effectiveFrom, command.effectiveTo),
    )).limit(1);
    return rows.length > 0;
  },
  async insertConfiguration(command) {
    const [row] = await executor.insert(payrollConfigurations).values({
      shopId: numericId(command.shopId), branchId: command.branchId === null ? null : numericId(command.branchId),
      configKey: command.configKey, numericValue: command.numericValue, unit: command.unit,
      effectiveFrom: command.effectiveFrom, effectiveTo: command.effectiveTo,
      createdByUserAccountId: numericId(command.actorId),
    }).returning();
    return toConfiguration(row);
  },
  async resolveConfiguration(shopId, branchId, key, date, forUpdate = false) {
    const query = executor.select().from(payrollConfigurations).where(and(
      eq(payrollConfigurations.shopId, numericId(shopId)), eq(payrollConfigurations.configKey, key),
      lte(payrollConfigurations.effectiveFrom, date),
      or(isNull(payrollConfigurations.effectiveTo), gte(payrollConfigurations.effectiveTo, date)),
      branchId === null
        ? isNull(payrollConfigurations.branchId)
        : or(eq(payrollConfigurations.branchId, numericId(branchId)), isNull(payrollConfigurations.branchId)),
    )).orderBy(desc(payrollConfigurations.branchId), desc(payrollConfigurations.effectiveFrom)).limit(1);
    const rows = forUpdate ? await query.for("update") : await query;
    return rows[0] ? toConfiguration(rows[0]) : null;
  },
  async findPeriodByMonth(shopId, year, month) {
    const [row] = await executor.select().from(payrollPeriods).where(and(
      eq(payrollPeriods.shopId, numericId(shopId)), eq(payrollPeriods.periodYear, year), eq(payrollPeriods.periodMonth, month),
    )).limit(1);
    return row ? toPeriod(row) : null;
  },
  async insertPeriod(command) {
    const [row] = await executor.insert(payrollPeriods).values({
      shopId: numericId(command.shopId), periodYear: command.periodYear, periodMonth: command.periodMonth,
      startDate: command.startDate, endDate: command.endDate,
      createdByUserAccountId: numericId(command.actorId),
    }).returning();
    return toPeriod(row);
  },
  async findPeriod(periodId, forUpdate = false) {
    const query = executor.select().from(payrollPeriods).where(eq(payrollPeriods.id, numericId(periodId))).limit(1);
    const rows = forUpdate ? await query.for("update") : await query;
    return rows[0] ? toPeriod(rows[0]) : null;
  },
  async setPreviewed(periodId) {
    const [row] = await executor.update(payrollPeriods).set({ status: "previewed", previewedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(payrollPeriods.id, numericId(periodId)), inArray(payrollPeriods.status, ["draft", "previewed"]))).returning();
    if (!row) throw new Error("PAYROLL_PERIOD_STATE_CONFLICT");
    return toPeriod(row);
  },
  async setLocked(periodId, actorId) {
    const [row] = await executor.update(payrollPeriods).set({
      status: "locked", lockedByUserAccountId: numericId(actorId), lockedAt: new Date(), updatedAt: new Date(),
    }).where(and(eq(payrollPeriods.id, numericId(periodId)), inArray(payrollPeriods.status, ["draft", "previewed"]))).returning();
    if (!row) throw new Error("PAYROLL_PERIOD_STATE_CONFLICT");
    return toPeriod(row);
  },
  async replaceCalculatedRecords(periodId, records, actorId, locked) {
    const period = numericId(periodId);
    const old = await executor.select({ id: payrollRecords.id }).from(payrollRecords).where(and(
      eq(payrollRecords.payrollPeriodId, period), inArray(payrollRecords.status, ["draft", "calculated"]),
    ));
    if (old.length > 0) {
      await executor.delete(payrollItems).where(inArray(payrollItems.payrollRecordId, old.map((row) => row.id)));
      await executor.delete(payrollRecords).where(inArray(payrollRecords.id, old.map((row) => row.id)));
    }
    for (const record of records) {
      const [inserted] = await executor.insert(payrollRecords).values({
        payrollPeriodId: period, employeeId: numericId(record.employeeId), employmentAssignmentId: numericId(record.assignmentId),
        status: locked ? "locked" : "calculated", baseSalarySnapshot: record.baseSalarySnapshot,
        welfareSnapshot: record.welfareSnapshot, totalEarnings: record.totalEarnings,
        totalDeductions: record.totalDeductions, netPay: record.netPay,
        calculatedAt: new Date(), calculatedByUserAccountId: numericId(actorId), lockedAt: locked ? new Date() : null,
      }).returning({ id: payrollRecords.id });
      for (const item of record.items) {
        const [insertedItem] = await executor.insert(payrollItems).values({
          payrollRecordId: inserted.id, itemType: item.itemType, direction: item.direction,
          description: item.description, quantity: item.quantity, rate: item.rate, amount: item.amount,
          payrollConfigurationId: item.payrollConfigurationId === null ? null : numericId(item.payrollConfigurationId),
          sourceTable: item.sourceTable, sourceId: item.sourceId === null ? null : numericId(item.sourceId), occurredOn: item.occurredOn,
        }).returning({ id: payrollItems.id });
        if (locked && item.sourceTable === "payroll_adjustments" && item.sourceId !== null) {
          await executor.update(payrollAdjustments).set({ status: "applied", appliedPayrollItemId: insertedItem.id })
            .where(and(eq(payrollAdjustments.id, numericId(item.sourceId)), eq(payrollAdjustments.status, "approved")));
        }
      }
    }
  },
  async settleFinanceSources(periodId) {
    const records = await executor.select({ id: payrollRecords.id }).from(payrollRecords)
      .where(eq(payrollRecords.payrollPeriodId, numericId(periodId)));
    for (const record of records) {
      const sources = await executor.select({ table: payrollItems.sourceTable, id: payrollItems.sourceId })
        .from(payrollItems).where(eq(payrollItems.payrollRecordId, record.id));
      const loanIds = sources.filter((row) => row.table === "loan_installments" && row.id !== null).map((row) => row.id!);
      const debtIds = sources.filter((row) => row.table === "debt_transactions" && row.id !== null).map((row) => row.id!);
      const advanceIds = sources.filter((row) => row.table === "advance_requests" && row.id !== null).map((row) => row.id!);
      if (advanceIds.length) await executor.update(advanceRequests).set({ status: "deducted", updatedAt: new Date() }).where(and(inArray(advanceRequests.id, advanceIds), eq(advanceRequests.status, "approved")));
      if (loanIds.length) await executor.update(loanInstallments).set({ status: "deducted", deductedAt: new Date(), payrollRecordId: record.id, updatedAt: new Date() }).where(inArray(loanInstallments.id, loanIds));
      if (debtIds.length) await executor.update(debtTransactions).set({ settledAt: new Date(), settledInPayrollRecordId: record.id, updatedAt: new Date() }).where(inArray(debtTransactions.id, debtIds));
    }
  },
  async insertAdjustment(command) {
    const [row] = await executor.insert(payrollAdjustments).values({
      originalPayrollRecordId: numericId(command.originalRecordId), appliedPayrollPeriodId: numericId(command.targetPeriodId),
      direction: command.direction, amount: command.amount, reason: command.reason,
      requestedByUserAccountId: numericId(command.actorId),
    }).returning();
    return toAdjustment(row);
  },
  async findAdjustment(adjustmentId) {
    const [row] = await executor.select().from(payrollAdjustments).where(eq(payrollAdjustments.id, numericId(adjustmentId))).limit(1);
    return row ? toAdjustment(row) : null;
  },
  async decideAdjustment(adjustmentId, decision, actorId) {
    const [row] = await executor.update(payrollAdjustments).set({
      status: decision, approvedByUserAccountId: numericId(actorId), approvedAt: new Date(),
    }).where(and(eq(payrollAdjustments.id, numericId(adjustmentId)), eq(payrollAdjustments.status, "pending"))).returning();
    if (!row) throw new Error("PAYROLL_ADJUSTMENT_STATE_CONFLICT");
    return toAdjustment(row);
  },
  async findRecordState(recordId) {
    const [row] = await executor.select({ status: payrollRecords.status, branchId: employmentAssignments.branchId, periodEnd: payrollPeriods.endDate })
      .from(payrollRecords).innerJoin(employmentAssignments, eq(payrollRecords.employmentAssignmentId, employmentAssignments.id))
      .innerJoin(payrollPeriods, eq(payrollRecords.payrollPeriodId, payrollPeriods.id))
      .where(eq(payrollRecords.id, numericId(recordId))).limit(1);
    return row ? { status: row.status, branchId: id(row.branchId), periodEnd: row.periodEnd } : null;
  },
});

const toAdjustment = (row: typeof payrollAdjustments.$inferSelect): PayrollAdjustmentRecord => ({
  id: id(row.id), originalPayrollRecordId: id(row.originalPayrollRecordId),
  appliedPayrollPeriodId: row.appliedPayrollPeriodId === null ? null : id(row.appliedPayrollPeriodId),
  direction: row.direction, amount: row.amount, reason: row.reason, status: row.status,
  requestedByUserAccountId: id(row.requestedByUserAccountId), requestedAt: row.requestedAt,
  approvedByUserAccountId: row.approvedByUserAccountId === null ? null : id(row.approvedByUserAccountId),
  approvedAt: row.approvedAt, appliedPayrollItemId: row.appliedPayrollItemId === null ? null : id(row.appliedPayrollItemId),
});

export class DrizzlePayrollRepository implements PayrollRepository {
  withTransaction<T>(work: (session: PayrollRepositorySession) => Promise<T>): Promise<T> {
    return db.transaction((transaction) => work(createSession(transaction)));
  }
  async listConfigurations(shopId: string) {
    const rows = await db.select().from(payrollConfigurations).where(eq(payrollConfigurations.shopId, numericId(shopId)))
      .orderBy(asc(payrollConfigurations.configKey), desc(payrollConfigurations.effectiveFrom)).limit(500);
    return rows.map(toConfiguration);
  }
  async listPeriods(shopId: string) {
    const rows = await db.select().from(payrollPeriods).where(eq(payrollPeriods.shopId, numericId(shopId)))
      .orderBy(desc(payrollPeriods.periodYear), desc(payrollPeriods.periodMonth)).limit(120);
    return rows.map(toPeriod);
  }
  async findPeriod(periodId: string) {
    return createSession(db).findPeriod(periodId);
  }
  async findRecordBranch(recordId: string) {
    const [row] = await db.select({ branchId: employmentAssignments.branchId }).from(payrollRecords)
      .innerJoin(employmentAssignments, eq(payrollRecords.employmentAssignmentId, employmentAssignments.id))
      .where(eq(payrollRecords.id, numericId(recordId))).limit(1);
    return row ? id(row.branchId) : null;
  }
  async findRecordDetail(periodId: string, recordId: string) {
    const [row] = await db.select({
      id: payrollRecords.id, periodId: payrollRecords.payrollPeriodId,
      employeeId: payrollRecords.employeeId, assignmentId: payrollRecords.employmentAssignmentId,
      branchId: employmentAssignments.branchId, status: payrollRecords.status,
      baseSalarySnapshot: payrollRecords.baseSalarySnapshot, welfareSnapshot: payrollRecords.welfareSnapshot,
      totalEarnings: payrollRecords.totalEarnings, totalDeductions: payrollRecords.totalDeductions,
      netPay: payrollRecords.netPay,
    }).from(payrollRecords)
      .innerJoin(employmentAssignments, eq(payrollRecords.employmentAssignmentId, employmentAssignments.id))
      .where(and(eq(payrollRecords.id, numericId(recordId)), eq(payrollRecords.payrollPeriodId, numericId(periodId))))
      .limit(1);
    if (!row) return null;
    const items = await db.select().from(payrollItems)
      .where(eq(payrollItems.payrollRecordId, row.id)).orderBy(asc(payrollItems.id));
    return {
      id: id(row.id), periodId: id(row.periodId), employeeId: id(row.employeeId),
      assignmentId: id(row.assignmentId), branchId: id(row.branchId), status: row.status,
      baseSalarySnapshot: row.baseSalarySnapshot, welfareSnapshot: row.welfareSnapshot,
      totalEarnings: row.totalEarnings, totalDeductions: row.totalDeductions, netPay: row.netPay,
      items: items.map((item) => ({
        itemType: item.itemType, direction: item.direction, description: item.description,
        quantity: item.quantity, rate: item.rate, amount: item.amount,
        payrollConfigurationId: item.payrollConfigurationId === null ? null : id(item.payrollConfigurationId),
        sourceTable: item.sourceTable, sourceId: item.sourceId === null ? null : id(item.sourceId),
        occurredOn: item.occurredOn,
      })),
    };
  }
  async listPeriodRecords(periodId: string, branchIds: readonly string[] | null) {
    if (branchIds !== null && branchIds.length === 0) return [];
    const rows = await db.select({ id: payrollRecords.id }).from(payrollRecords)
      .innerJoin(employmentAssignments, eq(payrollRecords.employmentAssignmentId, employmentAssignments.id))
      .where(and(
        eq(payrollRecords.payrollPeriodId, numericId(periodId)),
        branchIds === null ? undefined : inArray(employmentAssignments.branchId, branchIds.map(numericId)),
      )).orderBy(asc(payrollRecords.employeeId)).limit(500);
    const records = await Promise.all(rows.map((row) => this.findRecordDetail(periodId, id(row.id))));
    return records.filter((record): record is PayrollRecordDetail => record !== null);
  }
  async listAdjustments(recordId?: string) {
    const rows = await db.select().from(payrollAdjustments)
      .where(recordId ? eq(payrollAdjustments.originalPayrollRecordId, numericId(recordId)) : undefined)
      .orderBy(desc(payrollAdjustments.requestedAt)).limit(500);
    return rows.map(toAdjustment);
  }
}

// These imports intentionally anchor the canonical source tables used by the
// payroll read projection without importing any other feature repository.
export const payrollSourceTables = {
  employees, employmentAssignments, workDayRecords, leaveRequests, leaveRequestDays,
  overtimeRecords, advanceRequests, loans, loanInstallments, debtTransactions,
} as const;

export interface PayrollInputLoadResult {
  inputs: PayrollCalculationInput[];
  blockers: PayrollBlocker[];
  pendingApprovals: boolean;
}

export interface PayrollInputProvider {
  load(session: PayrollRepositorySession, period: PayrollPeriodRecord, options?: { lockSources?: boolean }): Promise<PayrollInputLoadResult>;
}

export const payrollInclusiveDates = (start: string, end: string): string[] => {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
};

export const payrollEffectiveOn = <T extends { effectiveFrom: string; effectiveTo: string | null }>(rows: readonly T[], date: string) =>
  rows.find((row) => row.effectiveFrom <= date && (row.effectiveTo === null || row.effectiveTo >= date));

export class DrizzlePayrollInputProvider implements PayrollInputProvider {
  async load(session: PayrollRepositorySession, period: PayrollPeriodRecord, options: { lockSources?: boolean } = {}): Promise<PayrollInputLoadResult> {
    const executor = session.executor;
    const assignmentQuery = executor.select({ assignment: employmentAssignments, employeeCode: employees.employeeCode })
      .from(employmentAssignments)
      .innerJoin(employees, eq(employmentAssignments.employeeId, employees.id))
      .where(and(
        eq(employmentAssignments.isPrimary, true),
        lte(employmentAssignments.effectiveFrom, period.endDate),
        or(isNull(employmentAssignments.effectiveTo), gte(employmentAssignments.effectiveTo, period.startDate)),
      )).orderBy(asc(employmentAssignments.employeeId), desc(employmentAssignments.effectiveFrom));
    const assignmentRows = options.lockSources ? await assignmentQuery.for("update", { of: employmentAssignments }) : await assignmentQuery;

    const assignmentsByEmployee = new Map<number, (typeof assignmentRows)[number][]>();
    for (const row of assignmentRows) {
      const rows = assignmentsByEmployee.get(row.assignment.employeeId) ?? [];
      rows.push(row);
      assignmentsByEmployee.set(row.assignment.employeeId, rows);
    }

    const pendingLeaveQuery = executor.select({ id: leaveRequests.id }).from(leaveRequests).where(and(
      eq(leaveRequests.status, "pending"), lte(leaveRequests.startDate, period.endDate), gte(leaveRequests.endDate, period.startDate),
    )).limit(1);
    const pendingLeave = options.lockSources ? await pendingLeaveQuery.for("update") : await pendingLeaveQuery;
    const pendingOtQuery = executor.select({ id: overtimeRecords.id }).from(overtimeRecords).where(and(
      eq(overtimeRecords.status, "pending"), gte(overtimeRecords.overtimeDate, period.startDate), lte(overtimeRecords.overtimeDate, period.endDate),
    )).limit(1);
    const pendingOt = options.lockSources ? await pendingOtQuery.for("update") : await pendingOtQuery;
    const pendingAdvanceQuery = executor.select({ id: advanceRequests.id }).from(advanceRequests).where(and(
      eq(advanceRequests.status, "pending"), eq(advanceRequests.requestMonth, `${period.startDate.slice(0, 7)}-01`),
    )).limit(1);
    const pendingAdvance = options.lockSources ? await pendingAdvanceQuery.for("update") : await pendingAdvanceQuery;
    const pendingAdjustmentQuery = executor.select({ id: payrollAdjustments.id }).from(payrollAdjustments).where(and(
      eq(payrollAdjustments.status, "pending"), eq(payrollAdjustments.appliedPayrollPeriodId, numericId(period.id)),
    )).limit(1);
    const pendingAdjustment = options.lockSources ? await pendingAdjustmentQuery.for("update") : await pendingAdjustmentQuery;

    const blockers: PayrollBlocker[] = [];
    const inputs: PayrollCalculationInput[] = [];
    for (const employeeAssignments of assignmentsByEmployee.values()) {
      const snapshotRow = payrollEffectiveOn(employeeAssignments.map((row) => row.assignment), period.endDate) ?? employeeAssignments[0]!.assignment;
      const employeeCode = employeeAssignments[0]!.employeeCode;
      const assignment = snapshotRow;
      const employeeId = id(assignment.employeeId);
      const branchId = id(assignment.branchId);
      const snapshotDate = assignment.effectiveTo && assignment.effectiveTo < period.endDate ? assignment.effectiveTo : period.endDate;
      const required = await Promise.all([
        session.resolveConfiguration(period.shopId, branchId, "STANDARD_WORK_DAYS", snapshotDate, options.lockSources),
        session.resolveConfiguration(period.shopId, branchId, "ABSENCE_RATE", snapshotDate, options.lockSources),
        session.resolveConfiguration(period.shopId, branchId, "LATE_RATE", snapshotDate, options.lockSources),
        session.resolveConfiguration(period.shopId, branchId, "SOCIAL_SECURITY_RATE", snapshotDate, options.lockSources),
        session.resolveConfiguration(period.shopId, branchId, "SOCIAL_SECURITY_CAP", snapshotDate, options.lockSources),
      ]);
      if (required.some((value) => value === null)) {
        blockers.push({ code: "PAYROLL_CONFIGURATION_MISSING", employeeId, detail: "Required effective payroll configuration is missing." });
        continue;
      }
      const configurationEvidence = new Map<string, PayrollCalculationInput["configurationEvidence"] extends readonly (infer T)[] | undefined ? T : never>();
      const rememberConfiguration = (configuration: PayrollConfigurationRecord, effectiveOn: string) => {
        configurationEvidence.set(configuration.id, { id: configuration.id, key: configuration.configKey,
          value: configuration.numericValue, effectiveOn });
      };
      for (const configuration of required) rememberConfiguration(configuration!, snapshotDate);
      const daysQuery = executor.select().from(workDayRecords).where(and(
        eq(workDayRecords.employeeId, assignment.employeeId), gte(workDayRecords.workDate, period.startDate), lte(workDayRecords.workDate, period.endDate),
      )).orderBy(asc(workDayRecords.workDate));
      const days = options.lockSources ? await daysQuery.for("update") : await daysQuery;
      const assignmentRowsOnly = employeeAssignments.map((row) => row.assignment);
      const branchIds = [...new Set(assignmentRowsOnly.map((row) => row.branchId))];
      const weeklyHolidayQuery = executor.select().from(employeeWeeklyHolidays).where(and(
          eq(employeeWeeklyHolidays.employeeId, assignment.employeeId),
          lte(employeeWeeklyHolidays.effectiveFrom, period.endDate),
          or(isNull(employeeWeeklyHolidays.effectiveTo), gte(employeeWeeklyHolidays.effectiveTo, period.startDate)),
        ));
      const publicHolidayQuery = executor.select().from(holidayCalendars).where(and(
          eq(holidayCalendars.shopId, numericId(period.shopId)), eq(holidayCalendars.isActive, true),
          gte(holidayCalendars.holidayDate, period.startDate), lte(holidayCalendars.holidayDate, period.endDate),
        ));
      const scheduleOverrideQuery = executor.select().from(branchScheduleOverrides).where(and(
          inArray(branchScheduleOverrides.branchId, branchIds),
          gte(branchScheduleOverrides.scheduleDate, period.startDate), lte(branchScheduleOverrides.scheduleDate, period.endDate),
        ));
      const scheduleQuery = executor.select().from(branchSchedules).where(and(
          inArray(branchSchedules.branchId, branchIds), lte(branchSchedules.effectiveFrom, period.endDate),
          or(isNull(branchSchedules.effectiveTo), gte(branchSchedules.effectiveTo, period.startDate)),
        ));
      const [weeklyHolidays, publicHolidays, scheduleOverrides, schedules] = await Promise.all([
        options.lockSources ? weeklyHolidayQuery.for("update") : weeklyHolidayQuery,
        options.lockSources ? publicHolidayQuery.for("update") : publicHolidayQuery,
        options.lockSources ? scheduleOverrideQuery.for("update") : scheduleOverrideQuery,
        options.lockSources ? scheduleQuery.for("update") : scheduleQuery,
      ]);
      const publicHolidayDates = new Set(publicHolidays.map((row) => row.holidayDate));
      const employmentStart = assignmentRowsOnly.reduce((earliest, row) => row.effectiveFrom < earliest ? row.effectiveFrom : earliest, period.endDate);
      const openEnded = assignmentRowsOnly.some((row) => row.effectiveTo === null || row.effectiveTo >= period.endDate);
      const employmentEnd = openEnded ? period.endDate : assignmentRowsOnly.reduce((latest, row) => row.effectiveTo && row.effectiveTo > latest ? row.effectiveTo : latest, period.startDate);
      const employmentDates = payrollInclusiveDates(
        employmentStart < period.startDate ? period.startDate : employmentStart,
        employmentEnd > period.endDate ? period.endDate : employmentEnd,
      );
      const assignmentGaps = employmentDates.filter((date) => !payrollEffectiveOn(assignmentRowsOnly, date));
      if (assignmentGaps.length > 0) {
        blockers.push({ code: "PAYROLL_ASSIGNMENT_MISSING", employeeId, detail: `No assignment is effective on ${assignmentGaps[0]}.` });
        continue;
      }
      const activeAssignmentDates = employmentDates;
      const missingSchedule = activeAssignmentDates.filter((date) => {
        const datedAssignment = payrollEffectiveOn(assignmentRowsOnly, date)!;
        return !payrollEffectiveOn(schedules.filter((row) => row.branchId === datedAssignment.branchId), date);
      });
      if (missingSchedule.length > 0) {
        blockers.push({ code: "PAYROLL_ATTENDANCE_INCOMPLETE", employeeId,
          detail: `No effective branch schedule exists for ${missingSchedule[0]}.` });
        continue;
      }
      const coveredDates = activeAssignmentDates
        .filter((date) => {
          const datedAssignment = payrollEffectiveOn(assignmentRowsOnly, date);
          if (!datedAssignment) return false;
          const branchSchedule = payrollEffectiveOn(schedules.filter((row) => row.branchId === datedAssignment.branchId), date);
          const override = scheduleOverrides.find((row) => row.branchId === datedAssignment.branchId && row.scheduleDate === date);
          const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
          const weeklyHoliday = weeklyHolidays.some((row) => row.weekday === weekday && row.effectiveFrom <= date && (row.effectiveTo === null || row.effectiveTo >= date));
          return branchSchedule !== undefined && !override?.isClosed && !weeklyHoliday && !publicHolidayDates.has(date);
        });
      const recordedDates = new Set(days.map((row) => row.workDate));
      const missingAttendance = coveredDates.filter((date) => !recordedDates.has(date));
      if (missingAttendance.length > 0) {
        blockers.push({ code: "PAYROLL_ATTENDANCE_INCOMPLETE", employeeId,
          detail: `Missing work-day facts for ${missingAttendance.slice(0, 3).join(", ")}${missingAttendance.length > 3 ? "…" : ""}.` });
        continue;
      }
      const dailyInputs: PayrollCalculationInput["workDays"][number][] = [];
      let dailyBlocked = false;
      for (const row of days) {
        const dayAssignment = payrollEffectiveOn(assignmentRowsOnly, row.workDate);
        if (!dayAssignment) {
          blockers.push({ code: "PAYROLL_ASSIGNMENT_MISSING", employeeId, detail: `No assignment is effective on ${row.workDate}.` });
          dailyBlocked = true;
          continue;
        }
        const dayBranchId = id(row.branchId);
        const [standardWorkDays, absenceRate, lateRate] = await Promise.all([
          session.resolveConfiguration(period.shopId, dayBranchId, "STANDARD_WORK_DAYS", row.workDate, options.lockSources),
          session.resolveConfiguration(period.shopId, dayBranchId, "ABSENCE_RATE", row.workDate, options.lockSources),
          session.resolveConfiguration(period.shopId, dayBranchId, "LATE_RATE", row.workDate, options.lockSources),
        ]);
        if (!standardWorkDays || !absenceRate || !lateRate) {
          blockers.push({ code: "PAYROLL_CONFIGURATION_MISSING", employeeId, detail: `Daily payroll configuration is missing for ${row.workDate}.` });
          dailyBlocked = true;
          continue;
        }
        rememberConfiguration(standardWorkDays, row.workDate);
        rememberConfiguration(absenceRate, row.workDate);
        rememberConfiguration(lateRate, row.workDate);
        dailyInputs.push({ id: id(row.id), date: row.workDate, status: row.status,
          lateMinutes: row.lateMinutes, deductible: row.isDeductible, baseSalary: dayAssignment.baseSalary,
          welfare: dayAssignment.welfareAmount, standardWorkDays: standardWorkDays.numericValue,
          assignmentId: id(dayAssignment.id), standardWorkDaysConfigurationId: standardWorkDays.id,
          absenceRate: absenceRate.numericValue, lateRate: lateRate.numericValue,
          absenceConfigurationId: absenceRate.id, lateConfigurationId: lateRate.id });
      }
      if (dailyBlocked) continue;
      const overtimeQuery = executor.select().from(overtimeRecords).where(and(
        eq(overtimeRecords.employeeId, assignment.employeeId), eq(overtimeRecords.status, "approved"),
        gte(overtimeRecords.overtimeDate, period.startDate), lte(overtimeRecords.overtimeDate, period.endDate),
      ));
      const overtimeRows = options.lockSources ? await overtimeQuery.for("update") : await overtimeQuery;
      const overtime = [] as PayrollCalculationInput["overtime"][number][];
      for (const row of overtimeRows) {
        const overtimeAssignment = payrollEffectiveOn(assignmentRowsOnly, row.overtimeDate);
        if (!overtimeAssignment) {
          blockers.push({ code: "PAYROLL_ASSIGNMENT_MISSING", employeeId, detail: `No assignment is effective for overtime on ${row.overtimeDate}.` });
          continue;
        }
        const key = row.overtimeType === "hourly" ? "OT_HOURLY_RATE" : row.overtimeType === "rest_day" ? "OT_REST_DAY_RATE" : "OT_PUBLIC_HOLIDAY_RATE";
        const overtimeBranchId = id(overtimeAssignment.branchId);
        const [config, overtimeWorkDays] = await Promise.all([
          session.resolveConfiguration(period.shopId, overtimeBranchId, key, row.overtimeDate, options.lockSources),
          session.resolveConfiguration(period.shopId, overtimeBranchId, "STANDARD_WORK_DAYS", row.overtimeDate, options.lockSources),
        ]);
        if (!config || !overtimeWorkDays) {
          blockers.push({ code: "PAYROLL_CONFIGURATION_MISSING", employeeId, detail: `${key} is missing for ${row.overtimeDate}.` });
          continue;
        }
        rememberConfiguration(config, row.overtimeDate);
        rememberConfiguration(overtimeWorkDays, row.overtimeDate);
        overtime.push({ id: id(row.id), date: row.overtimeDate, type: row.overtimeType,
          hours: row.hours, dayUnits: row.dayUnits, rate: config.numericValue, configurationId: config.id,
          baseSalary: overtimeAssignment.baseSalary, standardWorkDays: overtimeWorkDays.numericValue });
      }
      const advancesQuery = executor.select().from(advanceRequests).where(and(
        eq(advanceRequests.employeeId, assignment.employeeId), eq(advanceRequests.status, "approved"),
        eq(advanceRequests.requestMonth, `${period.startDate.slice(0, 7)}-01`),
      ));
      const advances = options.lockSources ? await advancesQuery.for("update") : await advancesQuery;
      const installmentsQuery = executor.select({ installment: loanInstallments }).from(loanInstallments)
        .innerJoin(loans, eq(loanInstallments.loanId, loans.id)).where(and(
          eq(loans.employeeId, assignment.employeeId), eq(loanInstallments.status, "scheduled"),
          lte(loanInstallments.duePeriodStart, period.startDate),
        ));
      const installments = options.lockSources ? await installmentsQuery.for("update", { of: loanInstallments }) : await installmentsQuery;
      const debtsQuery = executor.select().from(debtTransactions).where(and(
        eq(debtTransactions.employeeId, assignment.employeeId), ne(debtTransactions.transactionKind, "reversal"),
        lte(debtTransactions.transactionDate, period.endDate), isNull(debtTransactions.settledAt), isNull(debtTransactions.settledInPayrollRecordId),
      ));
      const debts = options.lockSources ? await debtsQuery.for("update") : await debtsQuery;
      const adjustmentsQuery = executor.select({ adjustment: payrollAdjustments }).from(payrollAdjustments)
        .innerJoin(payrollRecords, eq(payrollAdjustments.originalPayrollRecordId, payrollRecords.id)).where(and(
          eq(payrollAdjustments.appliedPayrollPeriodId, numericId(period.id)), eq(payrollAdjustments.status, "approved"),
          eq(payrollRecords.employeeId, assignment.employeeId),
        ));
      const adjustments = options.lockSources ? await adjustmentsQuery.for("update", { of: payrollAdjustments }) : await adjustmentsQuery;
      inputs.push({
        employeeId, employeeCode, assignmentId: id(assignment.id), branchId,
        baseSalary: assignment.baseSalary, welfare: assignment.welfareAmount,
        standardWorkDays: required[0]!.numericValue, absenceRate: required[1]!.numericValue,
        lateRate: required[2]!.numericValue, socialSecurityRate: required[3]!.numericValue,
        socialSecurityCap: required[4]!.numericValue,
        socialSecurityRateConfigurationId: required[3]!.id,
        configurationEvidence: [...configurationEvidence.values()],
        workDays: dailyInputs,
        overtime,
        deductions: [
          ...advances.map((row) => ({ id: id(row.id), type: "advance" as const, amount: row.amount, description: "Approved advance", date: row.requestMonth })),
          ...installments.map(({ installment }) => ({ id: id(installment.id), type: "loan_installment" as const, amount: installment.amount, description: "Loan installment", date: installment.duePeriodStart })),
          ...debts.map((row) => ({ id: id(row.id), type: "debt" as const, amount: row.amount, description: row.description, date: row.transactionDate })),
        ],
        adjustments: adjustments.map(({ adjustment }) => ({ id: id(adjustment.id), direction: adjustment.direction, amount: adjustment.amount, reason: adjustment.reason })),
      });
    }
    return { inputs, blockers, pendingApprovals: pendingLeave.length + pendingOt.length + pendingAdvance.length + pendingAdjustment.length > 0 };
  }
}
