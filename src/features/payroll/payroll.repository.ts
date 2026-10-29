import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { countMonthlyWorkDays } from "./calculation/monthly-workdays";
import { branches } from "../branch/branch.schema";
import { db } from "../../core/db/client";
import type { DatabaseExecutor } from "../../core/db/transaction";
import { advanceRequests } from "../advance/advance.schema";
import { workDayRecords } from "../attendance/attendance.schema";
import { branchScheduleOverrides, branchSchedules } from "../branch-schedule/branch-schedule.schema";
import { debtTransactions } from "../debt/debt.schema";
import { employeeWeeklyHolidays } from "../employee-weekly-holiday/employee-weekly-holiday.schema";
import { employees } from "../employee/employee.schema";
import { departments } from "../department/department.schema";
import { positions } from "../position/position.schema";
import { employeeBankAccounts } from "../employee-bank-account/employee-bank-account.schema";
import type { PayrollReadinessFacts } from "./payroll.readiness.types";
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
  PayrollRosterEntry,
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
  findConfigurationForUpdate(id:string):Promise<PayrollConfigurationRecord|null>;
  endConfiguration(id:string,date:string):Promise<void>;
  configurationRangeIsLocked(shopId:string,startDate:string,endDate:string|null):Promise<boolean>;
  findBranchInShop(branchId:string,shopId:string):Promise<boolean>;
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
  insertAdjustment(command: { employeeId: string; originalRecordId: string | null; targetPeriodId: string; direction: "earning" | "deduction"; amount: string; reason: string; actorId: string }): Promise<PayrollAdjustmentRecord>;
  findAdjustment(id: string): Promise<PayrollAdjustmentRecord | null>;
  decideAdjustment(id: string, decision: "approved" | "rejected", actorId: string): Promise<PayrollAdjustmentRecord>;
  findRecordState(id: string): Promise<{ status: "draft" | "calculated" | "locked"; branchId: string; shopId: string; employeeId: string; periodEnd: string } | null>;
  hasAssignmentForPeriod(employeeId:string,period:PayrollPeriodRecord):Promise<boolean>;
}

export interface PayrollRepository {
  withTransaction<T>(work: (session: PayrollRepositorySession) => Promise<T>): Promise<T>;
  listConfigurations(shopId: string): Promise<PayrollConfigurationRecord[]>;
  listPeriods(shopId: string): Promise<PayrollPeriodRecord[]>;
  findPeriod(id: string): Promise<PayrollPeriodRecord | null>;
  findRecordBranch(recordId: string): Promise<string | null>;
  findRecordDetail(periodId: string, recordId: string): Promise<PayrollRecordDetail | null>;
  listPeriodRecords(periodId: string, branchIds: readonly string[] | null): Promise<PayrollRecordDetail[]>;
  listPeriodRoster?(period: PayrollPeriodRecord, branchIds: readonly string[] | null): Promise<PayrollRosterEntry[]>;
  listReadinessFacts?(period:PayrollPeriodRecord,branchIds:readonly string[]|null):Promise<PayrollReadinessFacts>;
  listAdjustments(recordId?: string): Promise<PayrollAdjustmentRecord[]>;
}

export const createPayrollRepositorySession = (executor: Executor): PayrollRepositorySession => ({
  executor,
  async findActiveShop(shopId) {
    const [shop] = await executor.select({ id: shops.id }).from(shops)
      .where(and(eq(shops.id, numericId(shopId)), eq(shops.isActive, true))).limit(1);
    return shop !== undefined;
  },
  async findConfigurationForUpdate(configurationId) {
    const [row]=await executor.select().from(payrollConfigurations).where(eq(payrollConfigurations.id,numericId(configurationId))).limit(1).for("update");
    return row ? toConfiguration(row) : null;
  },
  async endConfiguration(configurationId,date) {
    await executor.update(payrollConfigurations).set({effectiveTo:date}).where(eq(payrollConfigurations.id,numericId(configurationId)));
  },
  async configurationRangeIsLocked(shopId,startDate,endDate) {
    const [row]=await executor.select({id:payrollPeriods.id}).from(payrollPeriods).where(and(eq(payrollPeriods.shopId,numericId(shopId)),eq(payrollPeriods.status,"locked"),gte(payrollPeriods.endDate,startDate),endDate===null?sql`true`:lte(payrollPeriods.startDate,endDate))).limit(1);
    return Boolean(row);
  },
  async findBranchInShop(branchId,shopId) {
    const [row]=await executor.select({id:branches.id}).from(branches).where(and(eq(branches.id,numericId(branchId)),eq(branches.shopId,numericId(shopId)),eq(branches.isActive,true))).limit(1);
    return Boolean(row);
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
    )).orderBy(sql`${payrollConfigurations.branchId} desc nulls last`, desc(payrollConfigurations.effectiveFrom)).limit(1);
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
        status: "calculated", baseSalarySnapshot: record.baseSalarySnapshot,
        welfareSnapshot: record.welfareSnapshot, isSocialSecurityMemberSnapshot: record.isSocialSecurityMemberSnapshot ?? true, socialSecurityBaseSnapshot: record.socialSecurityBaseSnapshot, totalEarnings: record.totalEarnings,
        totalDeductions: record.totalDeductions, netPay: record.netPay,
        calculatedAt: new Date(), calculatedByUserAccountId: numericId(actorId), lockedAt: null,
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
      // Finalize only after all snapshot lines exist; locked-item triggers then protect the complete record.
      if (locked) await executor.update(payrollRecords).set({ status: "locked", lockedAt: new Date(), updatedAt: new Date() })
        .where(eq(payrollRecords.id, inserted.id));
    }
  },
  async settleFinanceSources(periodId) {
    const records = await executor.select({ id: payrollRecords.id }).from(payrollRecords)
      .where(eq(payrollRecords.payrollPeriodId, numericId(periodId)));
    for (const record of records) {
      const sources = await executor.select({ table: payrollItems.sourceTable, id: payrollItems.sourceId })
        .from(payrollItems).where(eq(payrollItems.payrollRecordId, record.id));
      const loanIds = sources.filter((row) => row.table === "loan_installments" && row.id !== null).map((row) => row.id!);
      const advanceIds = sources.filter((row) => row.table === "advance_requests" && row.id !== null).map((row) => row.id!);
      if (advanceIds.length) await executor.update(advanceRequests).set({ status: "deducted", updatedAt: new Date() }).where(and(inArray(advanceRequests.id, advanceIds), eq(advanceRequests.status, "approved")));
      if (loanIds.length) await executor.update(loanInstallments).set({ status: "deducted", deductedAt: new Date(), payrollRecordId: record.id, updatedAt: new Date() }).where(inArray(loanInstallments.id, loanIds));
      // Frozen debt rows are append-only. Their locked source item is the settlement evidence.
    }
  },
  async insertAdjustment(command) {
    const [row] = await executor.insert(payrollAdjustments).values({
      employeeId: numericId(command.employeeId), originalPayrollRecordId: command.originalRecordId === null ? null : numericId(command.originalRecordId), appliedPayrollPeriodId: numericId(command.targetPeriodId),
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
    const [row] = await executor.select({ status: payrollRecords.status, branchId: employmentAssignments.branchId, shopId:payrollPeriods.shopId,employeeId:payrollRecords.employeeId, periodEnd: payrollPeriods.endDate })
      .from(payrollRecords).innerJoin(employmentAssignments, eq(payrollRecords.employmentAssignmentId, employmentAssignments.id))
      .innerJoin(payrollPeriods, eq(payrollRecords.payrollPeriodId, payrollPeriods.id))
      .where(eq(payrollRecords.id, numericId(recordId))).limit(1);
    return row ? { status: row.status, branchId: id(row.branchId),shopId:id(row.shopId),employeeId:id(row.employeeId), periodEnd: row.periodEnd } : null;
  },
  async hasAssignmentForPeriod(employeeId,period) {
    const rows=await executor.select({id:employmentAssignments.id}).from(employmentAssignments).innerJoin(branches,eq(branches.id,employmentAssignments.branchId)).where(and(eq(employmentAssignments.employeeId,numericId(employeeId)),eq(employmentAssignments.isPrimary,true),eq(branches.shopId,numericId(period.shopId)),lte(employmentAssignments.effectiveFrom,period.endDate),or(isNull(employmentAssignments.effectiveTo),gte(employmentAssignments.effectiveTo,period.startDate)))).limit(1);
    return rows.length>0;
  },
});

const toAdjustment = (row: typeof payrollAdjustments.$inferSelect): PayrollAdjustmentRecord => ({
  id: id(row.id), employeeId: id(row.employeeId), originalPayrollRecordId: row.originalPayrollRecordId === null ? null : id(row.originalPayrollRecordId),
  appliedPayrollPeriodId: row.appliedPayrollPeriodId === null ? null : id(row.appliedPayrollPeriodId),
  direction: row.direction, amount: row.amount, reason: row.reason, status: row.status,
  requestedByUserAccountId: id(row.requestedByUserAccountId), requestedAt: row.requestedAt,
  approvedByUserAccountId: row.approvedByUserAccountId === null ? null : id(row.approvedByUserAccountId),
  approvedAt: row.approvedAt, appliedPayrollItemId: row.appliedPayrollItemId === null ? null : id(row.appliedPayrollItemId),
});

export class DrizzlePayrollRepository implements PayrollRepository {
  async listReadinessFacts(period:PayrollPeriodRecord,branchIds:readonly string[]|null):Promise<PayrollReadinessFacts> {
    const roster=await this.listPeriodRoster(period,branchIds);
    const branchRows=await db.select({id:branches.id,name:branches.name}).from(branches).where(and(eq(branches.shopId,numericId(period.shopId)),branchIds===null?undefined:inArray(branches.id,branchIds.map(numericId))));
    const ids=[...new Set(roster.map(row=>numericId(row.employeeId)))],branchKeys=branchRows.map(row=>row.id);
    const [departmentRows,positionRows,configurations,schedules,attendance,weeklyHolidays,holidays,overrides,bankRows,leave,ot,advances,adjustments]=await Promise.all([
      db.select({branchId:departments.branchId}).from(departments).where(inArray(departments.branchId,branchKeys)),
      db.select({id:positions.id}).from(positions).where(eq(positions.shopId,numericId(period.shopId))),
      this.listConfigurations(period.shopId),
      db.select().from(branchSchedules).where(inArray(branchSchedules.branchId,branchKeys)),
      db.select({employeeId:workDayRecords.employeeId,date:workDayRecords.workDate}).from(workDayRecords).where(and(inArray(workDayRecords.employeeId,ids),inArray(workDayRecords.branchId,branchKeys),gte(workDayRecords.workDate,period.startDate),lte(workDayRecords.workDate,period.endDate))),
      db.select().from(employeeWeeklyHolidays).where(inArray(employeeWeeklyHolidays.employeeId,ids)),
      db.select({date:holidayCalendars.holidayDate}).from(holidayCalendars).where(and(eq(holidayCalendars.shopId,numericId(period.shopId)),eq(holidayCalendars.isActive,true),gte(holidayCalendars.holidayDate,period.startDate),lte(holidayCalendars.holidayDate,period.endDate))),
      db.select({branchId:branchScheduleOverrides.branchId,date:branchScheduleOverrides.scheduleDate,isClosed:branchScheduleOverrides.isClosed}).from(branchScheduleOverrides).where(and(inArray(branchScheduleOverrides.branchId,branchKeys),gte(branchScheduleOverrides.scheduleDate,period.startDate),lte(branchScheduleOverrides.scheduleDate,period.endDate))),
      db.select({employeeId:employeeBankAccounts.employeeId}).from(employeeBankAccounts).where(and(inArray(employeeBankAccounts.employeeId,ids),eq(employeeBankAccounts.isActive,true),eq(employeeBankAccounts.isPrimary,true),sql`${employeeBankAccounts.bankCode} <> ''`,sql`${employeeBankAccounts.accountHolderName} <> ''`)),
      db.select({employeeId:leaveRequests.employeeId,startDate:leaveRequests.startDate,endDate:leaveRequests.endDate}).from(leaveRequests).where(and(inArray(leaveRequests.employeeId,ids),eq(leaveRequests.status,"pending"),lte(leaveRequests.startDate,period.endDate),gte(leaveRequests.endDate,period.startDate))),
      db.select({employeeId:overtimeRecords.employeeId,date:overtimeRecords.overtimeDate,status:overtimeRecords.status,type:overtimeRecords.overtimeType}).from(overtimeRecords).where(and(inArray(overtimeRecords.employeeId,ids),gte(overtimeRecords.overtimeDate,period.startDate),lte(overtimeRecords.overtimeDate,period.endDate))),
      db.select({employeeId:advanceRequests.employeeId,date:advanceRequests.requestMonth}).from(advanceRequests).where(and(inArray(advanceRequests.employeeId,ids),eq(advanceRequests.status,"pending"),eq(advanceRequests.requestMonth,period.startDate))),
      db.select({employeeId:payrollAdjustments.employeeId}).from(payrollAdjustments).where(and(eq(payrollAdjustments.appliedPayrollPeriodId,numericId(period.id)),eq(payrollAdjustments.status,"pending"),inArray(payrollAdjustments.employeeId,ids))),
    ]);
    return {branches:branchRows.map(row=>({...row,id:id(row.id)})),departmentBranchIds:departmentRows.map(row=>id(row.branchId)),positionCount:positionRows.length,roster,configurations:configurations.filter(row=>row.branchId===null||branchKeys.includes(numericId(row.branchId))),
      schedules:schedules.map(row=>({branchId:id(row.branchId),effectiveFrom:row.effectiveFrom,effectiveTo:row.effectiveTo})),attendance:attendance.map(row=>({...row,employeeId:id(row.employeeId)})),weeklyHolidays:weeklyHolidays.map(row=>({employeeId:id(row.employeeId),weekday:row.weekday,effectiveFrom:row.effectiveFrom,effectiveTo:row.effectiveTo})),holidays:holidays.map(row=>row.date),overrides:overrides.map(row=>({...row,branchId:id(row.branchId)})),bankEmployeeIds:bankRows.map(row=>id(row.employeeId)),approvedOvertime:ot.filter(row=>row.status==="approved").map(row=>({employeeId:id(row.employeeId),date:row.date,type:row.type})),
      pending:[...leave.map(row=>({...row,kind:"leave",employeeId:id(row.employeeId)})),...ot.filter(row=>row.status==="pending").map(row=>({kind:"overtime",employeeId:id(row.employeeId),startDate:row.date,endDate:row.date})),...advances.map(row=>({kind:"advance",employeeId:id(row.employeeId),startDate:row.date,endDate:period.endDate})),...adjustments.map(row=>({kind:"adjustment",employeeId:id(row.employeeId),startDate:period.startDate,endDate:period.endDate}))]};
  }
  withTransaction<T>(work: (session: PayrollRepositorySession) => Promise<T>): Promise<T> {
    return db.transaction((transaction) => work(createPayrollRepositorySession(transaction)));
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
    return createPayrollRepositorySession(db).findPeriod(periodId);
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
      isSocialSecurityMemberSnapshot: payrollRecords.isSocialSecurityMemberSnapshot, socialSecurityBaseSnapshot: payrollRecords.socialSecurityBaseSnapshot,
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
      isSocialSecurityMemberSnapshot: row.isSocialSecurityMemberSnapshot, socialSecurityBaseSnapshot: row.socialSecurityBaseSnapshot,
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
      )).orderBy(asc(payrollRecords.employeeId));
    const records = await Promise.all(rows.map((row) => this.findRecordDetail(periodId, id(row.id))));
    return records.filter((record) => record !== null);
  }
  async listPeriodRoster(period:PayrollPeriodRecord,branchIds:readonly string[] | null):Promise<PayrollRosterEntry[]> {
    if(branchIds !== null && !branchIds.length)return [];
    const rows=await db.select({employeeId:employees.id,employeeCode:employees.employeeCode,firstName:employees.firstName,lastName:employees.lastName,branchId:branches.id,branchName:branches.name,effectiveFrom:employmentAssignments.effectiveFrom,effectiveTo:employmentAssignments.effectiveTo}).from(employmentAssignments)
      .innerJoin(employees,eq(employees.id,employmentAssignments.employeeId)).innerJoin(branches,eq(branches.id,employmentAssignments.branchId))
      .where(and(eq(branches.shopId,numericId(period.shopId)),eq(employmentAssignments.isPrimary,true),lte(employmentAssignments.effectiveFrom,period.endDate),or(isNull(employmentAssignments.effectiveTo),gte(employmentAssignments.effectiveTo,period.startDate)),branchIds === null ? undefined : inArray(branches.id,branchIds.map(numericId))))
      .orderBy(asc(employees.employeeCode),asc(employmentAssignments.effectiveFrom));
    return rows.map(({firstName,lastName,...row})=>({...row,employeeId:id(row.employeeId),branchId:id(row.branchId),employeeName:`${firstName} ${lastName}`}));
  }
  async listAdjustments(recordId?: string) {
    const rows = await db.select().from(payrollAdjustments)
      .where(recordId ? eq(payrollAdjustments.originalPayrollRecordId, numericId(recordId)) : undefined)
      .orderBy(desc(payrollAdjustments.requestedAt));
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
  load(session: PayrollRepositorySession, period: PayrollPeriodRecord, options?: { lockSources?: boolean; projectionCutoff?: string }): Promise<PayrollInputLoadResult>;
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
  async load(session: PayrollRepositorySession, period: PayrollPeriodRecord, options: { lockSources?: boolean; projectionCutoff?: string } = {}): Promise<PayrollInputLoadResult> {
    const executor = session.executor;
    const earningEnd = options.projectionCutoff ?? period.endDate;
    const assignmentQuery = executor.select({ assignment: employmentAssignments, employeeCode: employees.employeeCode, firstName: employees.firstName, lastName: employees.lastName })
      .from(employmentAssignments)
      .innerJoin(employees, eq(employmentAssignments.employeeId, employees.id))
      .innerJoin(branches, eq(employmentAssignments.branchId, branches.id))
      .where(and(
        eq(branches.shopId, numericId(period.shopId)),
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

    const employeeIds = [...assignmentsByEmployee.keys()];
    if (employeeIds.length === 0) return { inputs: [], blockers: [], pendingApprovals: false };

    const pendingLeaveQuery = executor.select({ id: leaveRequests.id }).from(leaveRequests).where(and(
      inArray(leaveRequests.employeeId, employeeIds), eq(leaveRequests.status, "pending"), lte(leaveRequests.startDate, period.endDate), gte(leaveRequests.endDate, period.startDate),
    )).limit(1);
    const pendingLeave = options.lockSources ? await pendingLeaveQuery.for("update") : await pendingLeaveQuery;
    const pendingOtQuery = executor.select({ id: overtimeRecords.id }).from(overtimeRecords).where(and(
      inArray(overtimeRecords.employeeId, employeeIds), eq(overtimeRecords.status, "pending"), gte(overtimeRecords.overtimeDate, period.startDate), lte(overtimeRecords.overtimeDate, period.endDate),
    )).limit(1);
    const pendingOt = options.lockSources ? await pendingOtQuery.for("update") : await pendingOtQuery;
    const pendingAdvanceQuery = executor.select({ id: advanceRequests.id }).from(advanceRequests).where(and(
      inArray(advanceRequests.employeeId, employeeIds), eq(advanceRequests.status, "pending"), eq(advanceRequests.requestMonth, `${period.startDate.slice(0, 7)}-01`),
    )).limit(1);
    const pendingAdvance = options.lockSources ? await pendingAdvanceQuery.for("update") : await pendingAdvanceQuery;
    const pendingAdjustmentQuery = executor.select({ id: payrollAdjustments.id }).from(payrollAdjustments).where(and(
      eq(payrollAdjustments.status, "pending"), eq(payrollAdjustments.appliedPayrollPeriodId, numericId(period.id)),
    )).limit(1);
    const pendingAdjustment = options.lockSources ? await pendingAdjustmentQuery.for("update") : await pendingAdjustmentQuery;

    const blockers: PayrollBlocker[] = [];
    const inputs: PayrollCalculationInput[] = [];
    for (const employeeAssignments of assignmentsByEmployee.values()) {
      const snapshotRow = payrollEffectiveOn(employeeAssignments.map((row) => row.assignment), earningEnd) ?? employeeAssignments.map(row => row.assignment).sort((a,b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]!;
      const employeeCode = employeeAssignments[0]!.employeeCode;
      const assignment = snapshotRow;
      const employeeId = id(assignment.employeeId);
      const branchId = id(assignment.branchId);
      const addBlocker = (blocker:PayrollBlocker) => blockers.push({...blocker,employeeName:`${employeeAssignments[0]!.firstName} ${employeeAssignments[0]!.lastName}`,branchId});
      const snapshotDate = assignment.effectiveTo && assignment.effectiveTo < earningEnd ? assignment.effectiveTo : earningEnd;
      const required = await Promise.all([
        session.resolveConfiguration(period.shopId, branchId, "ABSENCE_RATE", snapshotDate, options.lockSources),
        session.resolveConfiguration(period.shopId, branchId, "LATE_RATE", snapshotDate, options.lockSources),
        session.resolveConfiguration(period.shopId, branchId, "SOCIAL_SECURITY_RATE", snapshotDate, options.lockSources),
        session.resolveConfiguration(period.shopId, branchId, "SOCIAL_SECURITY_CAP", snapshotDate, options.lockSources),
      ]);
      if (required.some((value) => value === null)) {
        const keys=["ABSENCE_RATE","LATE_RATE","SOCIAL_SECURITY_RATE","SOCIAL_SECURITY_CAP"].filter((_key,index)=>required[index]===null);
        addBlocker({ code: "PAYROLL_CONFIGURATION_MISSING", employeeId, configurationKeys:keys,affectedDates:[snapshotDate],detail: `ยังไม่มีค่าคำนวณ ${keys.join(", ")} ที่มีผลวันที่ ${snapshotDate} ให้เพิ่มค่าของสาขานี้หรือค่ากลางของร้านในส่วนค่าคำนวณ` });
        continue;
      }
      const configurationEvidence = new Map<string, PayrollCalculationInput["configurationEvidence"] extends readonly (infer T)[] | undefined ? T : never>();
      const rememberConfiguration = (configuration: PayrollConfigurationRecord, effectiveOn: string) => {
        configurationEvidence.set(configuration.id, { id: configuration.id, key: configuration.configKey,
          value: configuration.numericValue, effectiveOn });
      };
      for (const configuration of required) rememberConfiguration(configuration!, snapshotDate);
      const daysQuery = executor.select().from(workDayRecords).where(and(
        eq(workDayRecords.employeeId, assignment.employeeId), gte(workDayRecords.workDate, period.startDate), lte(workDayRecords.workDate, earningEnd),
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
      const activeAssignmentDates = employmentDates.filter((date) => date <= earningEnd);
      const assignmentGaps = employmentDates.filter((date) => !payrollEffectiveOn(assignmentRowsOnly, date));
      if (assignmentGaps.length > 0) {
        addBlocker({ code: "PAYROLL_ASSIGNMENT_MISSING", employeeId, affectedDates: assignmentGaps, detail: `ประวัติการสังกัดขาดช่วงวันที่ ${assignmentGaps[0]} ให้ตรวจประวัติการจ้างในหน้าพนักงาน` });
        continue;
      }
      const missingSchedule = employmentDates.filter((date) => {
        const datedAssignment = payrollEffectiveOn(assignmentRowsOnly, date)!;
        return !payrollEffectiveOn(schedules.filter((row) => row.branchId === datedAssignment.branchId), date);
      });
      if (missingSchedule.length > 0) {
        addBlocker({ code: "PAYROLL_ATTENDANCE_INCOMPLETE", employeeId,
          affectedDates: missingSchedule, detail: `ยังไม่มีตารางสาขาที่มีผลวันที่ ${missingSchedule[0]} ให้เพิ่มตารางในหน้าตารางและวันหยุด โดยเริ่มใช้ไม่ช้ากว่าวันนี้` });
        continue;
      }
      const workdayCalendarEvidence = employmentDates.map((date) => {
        const datedAssignment = payrollEffectiveOn(assignmentRowsOnly, date)!;
        const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
        const reasons: string[] = [];
        if (weeklyHolidays.some((row) => row.weekday === weekday && row.effectiveFrom <= date && (row.effectiveTo === null || row.effectiveTo >= date))) reasons.push("weekly");
        if (publicHolidayDates.has(date)) reasons.push("public");
        if (scheduleOverrides.some((row) => row.branchId === datedAssignment.branchId && row.scheduleDate === date && row.isClosed)) reasons.push("branch_closed");
        return { date, branchId: id(datedAssignment.branchId), working: reasons.length === 0, reasons };
      });
      const monthlyWorkDays = countMonthlyWorkDays(employmentDates, {
        weekly: weeklyHolidays, publicDates: [...publicHolidayDates],
        closedDates: workdayCalendarEvidence.filter((day) => day.reasons.includes("branch_closed")).map((day) => day.date),
      });
      if (monthlyWorkDays === 0) {
        addBlocker({ code: "PAYROLL_ATTENDANCE_INCOMPLETE", employeeId, affectedDates: employmentDates, detail: "ช่วงการจ้างไม่มีวันทำงานมาตรฐาน กรุณาตรวจสอบวันหยุดและตารางสาขา" });
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
        addBlocker({ code: "PAYROLL_ATTENDANCE_INCOMPLETE", employeeId,
          affectedDates: missingAttendance, detail: `ยังขาดรายการลงเวลา ${missingAttendance.length} วัน: ${missingAttendance.join(", ")} ให้บันทึกหรือแก้ไขรายการในหน้าลงเวลา` });
        continue;
      }
      const dailyInputs: PayrollCalculationInput["workDays"][number][] = [];
      let dailyBlocked = false;
      for (const row of days) {
        const dayAssignment = payrollEffectiveOn(assignmentRowsOnly, row.workDate);
        if (!dayAssignment) {
          addBlocker({ code: "PAYROLL_ASSIGNMENT_MISSING", employeeId, affectedDates: [row.workDate], detail: `ไม่มีประวัติการสังกัดที่มีผลวันที่ ${row.workDate}` });
          dailyBlocked = true;
          continue;
        }
        const dayBranchId = id(row.branchId);
        const [absenceRate, lateRate] = await Promise.all([
          session.resolveConfiguration(period.shopId, dayBranchId, "ABSENCE_RATE", row.workDate, options.lockSources),
          session.resolveConfiguration(period.shopId, dayBranchId, "LATE_RATE", row.workDate, options.lockSources),
        ]);
        if (!absenceRate || !lateRate) {
          addBlocker({ code: "PAYROLL_CONFIGURATION_MISSING", employeeId, affectedDates: [row.workDate], configurationKeys: [!absenceRate ? "ABSENCE_RATE" : "", !lateRate ? "LATE_RATE" : ""].filter(Boolean), detail: `ค่าคำนวณรายวันไม่ครบวันที่ ${row.workDate} ให้ตรวจช่วงเริ่มและสิ้นสุดของค่าคำนวณ` });
          dailyBlocked = true;
          continue;
        }
        rememberConfiguration(absenceRate, row.workDate);
        rememberConfiguration(lateRate, row.workDate);
        dailyInputs.push({ id: id(row.id), date: row.workDate, status: row.status,
          lateMinutes: row.lateMinutes, deductible: row.isDeductible, baseSalary: dayAssignment.baseSalary,
          isSocialSecurityMember: dayAssignment.isSocialSecurityMember, welfare: dayAssignment.welfareAmount, standardWorkDays: String(monthlyWorkDays),
          assignmentId: id(dayAssignment.id),
          absenceRate: absenceRate.numericValue, lateRate: lateRate.numericValue,
          absenceConfigurationId: absenceRate.id, lateConfigurationId: lateRate.id });
      }
      if (dailyBlocked) continue;
      const leaveEvidenceQuery = executor.select({ day: leaveRequestDays, request: leaveRequests }).from(leaveRequestDays)
        .innerJoin(leaveRequests, eq(leaveRequestDays.leaveRequestId, leaveRequests.id)).where(and(
          eq(leaveRequests.employeeId, assignment.employeeId), eq(leaveRequests.status, "approved"),
          gte(leaveRequestDays.leaveDate, period.startDate), lte(leaveRequestDays.leaveDate, earningEnd),
        ));
      const leaveEvidence = options.lockSources ? await leaveEvidenceQuery.for("update", { of: [leaveRequestDays, leaveRequests] }) : await leaveEvidenceQuery;
      const overtimeQuery = executor.select().from(overtimeRecords).where(and(
        eq(overtimeRecords.employeeId, assignment.employeeId), eq(overtimeRecords.status, "approved"),
        gte(overtimeRecords.overtimeDate, period.startDate), lte(overtimeRecords.overtimeDate, earningEnd),
      ));
      const overtimeRows = options.lockSources ? await overtimeQuery.for("update") : await overtimeQuery;
      const overtime = [] as PayrollCalculationInput["overtime"][number][];
      for (const row of overtimeRows) {
        const overtimeAssignment = payrollEffectiveOn(assignmentRowsOnly, row.overtimeDate);
        if (!overtimeAssignment) {
          addBlocker({ code: "PAYROLL_ASSIGNMENT_MISSING", employeeId, affectedDates: [row.overtimeDate], detail: `ไม่มีประวัติการสังกัดสำหรับ OT วันที่ ${row.overtimeDate}` });
          continue;
        }
        const key = row.overtimeType === "hourly" ? "OT_HOURLY_RATE" : row.overtimeType === "rest_day" ? "OT_REST_DAY_RATE" : "OT_PUBLIC_HOLIDAY_RATE";
        const overtimeBranchId = id(overtimeAssignment.branchId);
        const config = await session.resolveConfiguration(period.shopId, overtimeBranchId, key, row.overtimeDate, options.lockSources);
        if (!config) {
          addBlocker({ code: "PAYROLL_CONFIGURATION_MISSING", employeeId, configurationKeys: [key], affectedDates: [row.overtimeDate], detail: `ยังไม่มีค่า ${key} สำหรับ OT วันที่ ${row.overtimeDate}` });
          continue;
        }
        rememberConfiguration(config, row.overtimeDate);
        overtime.push({ id: id(row.id), date: row.overtimeDate, type: row.overtimeType,
          hours: row.hours, dayUnits: row.dayUnits, rate: config.numericValue, configurationId: config.id,
          baseSalary: overtimeAssignment.baseSalary, standardWorkDays: String(monthlyWorkDays) });
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
        sql`not exists (select 1 from debt_transactions reversal where reversal.original_transaction_id = ${debtTransactions.id} and reversal.transaction_kind = 'reversal')`,
        sql`not exists (select 1 from payroll_items pi inner join payroll_records pr on pr.id = pi.payroll_record_id
          where pi.source_table = 'debt_transactions' and pi.source_id = ${debtTransactions.id} and pr.status = 'locked')`,
        lte(debtTransactions.transactionDate, period.endDate), isNull(debtTransactions.settledAt), isNull(debtTransactions.settledInPayrollRecordId),
      ));
      const debts = options.lockSources ? await debtsQuery.for("update") : await debtsQuery;
      const adjustmentsQuery = executor.select({ adjustment: payrollAdjustments }).from(payrollAdjustments)
        .where(and(
          eq(payrollAdjustments.appliedPayrollPeriodId, numericId(period.id)), eq(payrollAdjustments.status, "approved"),
          eq(payrollAdjustments.employeeId, assignment.employeeId),
        ));
      const adjustments = options.lockSources ? await adjustmentsQuery.for("update", { of: payrollAdjustments }) : await adjustmentsQuery;
      inputs.push({
        employeeId, employeeCode, assignmentId: id(assignment.id), branchId,
        isSocialSecurityMember: assignment.isSocialSecurityMember, baseSalary: assignment.baseSalary, welfare: assignment.welfareAmount,
        standardWorkDays: String(monthlyWorkDays), absenceRate: required[0]!.numericValue,
        lateRate: required[1]!.numericValue, socialSecurityRate: required[2]!.numericValue,
        socialSecurityCap: required[3]!.numericValue,
        socialSecurityRateConfigurationId: required[2]!.id,
        workdayCalendarEvidence,
        configurationEvidence: [...configurationEvidence.values()],
        workDays: dailyInputs,
        approvedLeaveEvidence: leaveEvidence.map(({ day, request }) => ({
          id: id(day.id), requestId: id(request.id), date: day.leaveDate,
          originalTypeId: id(request.originalLeaveTypeId), approvedTypeId: id(day.leaveTypeId),
          paid: day.isPaid, deductible: day.isDeductible, quotaConsumed: day.quotaConsumed,
        })),
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


export type PayrollInputMutation = {
  employeeId?: number; branchId?: number; shopId?: number; startDate: string; endDate: string;
};

export class DrizzlePayrollInputRepository {
  async findDebtSettlement(executor: DatabaseExecutor, debtId: number): Promise<{ payrollRecordId: number; settledAt: Date } | undefined> {
    const [row] = await executor.select({ payrollRecordId: payrollRecords.id, settledAt: payrollRecords.lockedAt })
      .from(payrollItems).innerJoin(payrollRecords, eq(payrollItems.payrollRecordId, payrollRecords.id))
      .where(and(eq(payrollItems.sourceTable, "debt_transactions"), eq(payrollItems.sourceId, debtId), eq(payrollRecords.status, "locked"))).limit(1);
    return row?.settledAt ? { payrollRecordId: row.payrollRecordId, settledAt: row.settledAt } : undefined;
  }
  session(executor: DatabaseExecutor): PayrollRepositorySession { return createPayrollRepositorySession(executor); }
  async findLockedInputPeriod(executor: DatabaseExecutor, target: PayrollInputMutation): Promise<boolean> {
    const conditions = [eq(payrollPeriods.status, "locked"), lte(payrollPeriods.startDate, target.endDate), gte(payrollPeriods.endDate, target.startDate)];
    if (target.shopId !== undefined) conditions.push(eq(payrollPeriods.shopId, target.shopId));
    if (target.branchId !== undefined) conditions.push(sql`exists (select 1 from branches b where b.id = ${target.branchId} and b.shop_id = ${payrollPeriods.shopId})`);
    if (target.employeeId !== undefined) conditions.push(sql`(
      exists (select 1 from payroll_records r where r.payroll_period_id = ${payrollPeriods.id} and r.employee_id = ${target.employeeId})
      or exists (select 1 from employment_assignments a inner join branches b on b.id = a.branch_id
        where a.employee_id = ${target.employeeId} and b.shop_id = ${payrollPeriods.shopId}
        and a.effective_from <= ${target.endDate} and (a.effective_to is null or a.effective_to >= ${target.startDate}))
    )`);
    const rows = await executor.select({ id: payrollPeriods.id }).from(payrollPeriods).where(and(...conditions)).limit(1);
    return rows.length > 0;
  }

  async findProjectionPeriod(executor: DatabaseExecutor, employeeId: number, date: string): Promise<PayrollPeriodRecord | null> {
    const [row] = await executor.select({ period: payrollPeriods }).from(payrollPeriods)
      .innerJoin(branches, eq(branches.shopId, payrollPeriods.shopId))
      .innerJoin(employmentAssignments, eq(employmentAssignments.branchId, branches.id))
      .where(and(eq(employmentAssignments.employeeId, employeeId), eq(employmentAssignments.isPrimary, true),
        lte(employmentAssignments.effectiveFrom, date), or(isNull(employmentAssignments.effectiveTo), gte(employmentAssignments.effectiveTo, date)),
        lte(payrollPeriods.startDate, date), gte(payrollPeriods.endDate, date))).limit(1);
    return row ? toPeriod(row.period) : null;
  }
}
