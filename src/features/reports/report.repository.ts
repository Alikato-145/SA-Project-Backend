import { and, eq, sql, count, countDistinct, sum, exists, lte, gte, or, isNull } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { DatabaseExecutor } from "../../core/db/transaction";
import { payrollPeriods, payrollRecords, payrollItems } from "../payroll/payroll.schema";
import { employees } from "../employee/employee.schema";
import { payrollPayments } from "../payroll/payroll-payment.schema";
import { employmentAssignments } from "../employment-assignment/employment-assignment.schema";
import { branches } from "../branch/branch.schema";
import { workDayRecords } from "../attendance/attendance.schema";
import { leaveRequests, leaveRequestDays } from "../leave/leave.schema";
import { departments } from "../department/department.schema";
import { overtimeRecords } from "../overtime/overtime.schema";
import { debtTransactions } from "../debt/debt.schema";

const id = (value: string) => Number(value);
import type { ReportFilters,ReportKind } from "./report.types";
const assignmentMatch=(executor:DatabaseExecutor,shopId:number,filters:ReportFilters,employee:AnyPgColumn,date:AnyPgColumn,snapshotBranch?:AnyPgColumn)=>exists(executor.select({id:employmentAssignments.id}).from(employmentAssignments).innerJoin(branches,eq(branches.id,employmentAssignments.branchId)).where(and(eq(employmentAssignments.employeeId,employee),eq(branches.shopId,shopId),eq(employmentAssignments.isPrimary,true),lte(employmentAssignments.effectiveFrom,date),or(isNull(employmentAssignments.effectiveTo),gte(employmentAssignments.effectiveTo,date)),snapshotBranch ? eq(branches.id,snapshotBranch):undefined,filters.branchId ? eq(branches.id,id(filters.branchId)):undefined,filters.departmentId ? eq(employmentAssignments.departmentId,id(filters.departmentId)):undefined)));
export const reportRepository = {
  async findBranch(executor:DatabaseExecutor,branchId:string) {return executor.query.branches.findFirst({where:eq(branches.id,id(branchId))});},
  async findDepartment(executor:DatabaseExecutor,departmentId:string) {return executor.query.departments.findFirst({where:eq(departments.id,id(departmentId))});},
  async findPeriod(executor:DatabaseExecutor,periodId:string) { return executor.query.payrollPeriods.findFirst({where:eq(payrollPeriods.id,id(periodId))}); },
  async details(executor:DatabaseExecutor,period:typeof payrollPeriods.$inferSelect,kind:ReportKind,filters:ReportFilters={}) {
    const employee={employeeId:employees.id,employeeCode:employees.employeeCode,firstName:employees.firstName,lastName:employees.lastName};
    const match=(employee:AnyPgColumn,date:AnyPgColumn,snapshotBranch?:AnyPgColumn)=>assignmentMatch(executor,period.shopId,filters,employee,date,snapshotBranch);
    if(kind==="attendance")return executor.select({...employee,id:workDayRecords.id,date:workDayRecords.workDate,status:workDayRecords.status,quantity:sql<string|null>`null`,amount:sql<string|null>`null`}).from(workDayRecords).innerJoin(employees,eq(employees.id,workDayRecords.employeeId)).where(and(match(workDayRecords.employeeId,workDayRecords.workDate,workDayRecords.branchId),gte(workDayRecords.workDate,period.startDate),lte(workDayRecords.workDate,period.endDate))).orderBy(workDayRecords.workDate,workDayRecords.id);
    if(kind==="leave")return executor.select({...employee,id:leaveRequestDays.id,date:leaveRequestDays.leaveDate,status:leaveRequests.status,quantity:leaveRequestDays.dayAmount,quantityUnit:sql<string>`'days'`,amount:sql<string|null>`null`}).from(leaveRequestDays).innerJoin(leaveRequests,eq(leaveRequests.id,leaveRequestDays.leaveRequestId)).innerJoin(employees,eq(employees.id,leaveRequests.employeeId)).where(and(match(leaveRequests.employeeId,leaveRequestDays.leaveDate),gte(leaveRequestDays.leaveDate,period.startDate),lte(leaveRequestDays.leaveDate,period.endDate))).orderBy(leaveRequestDays.leaveDate,leaveRequestDays.id);
    if(kind==="overtime")return executor.select({...employee,id:overtimeRecords.id,date:overtimeRecords.overtimeDate,status:overtimeRecords.status,quantity:sql<string>`coalesce(${overtimeRecords.hours},${overtimeRecords.dayUnits})::text`,quantityUnit:sql<string>`case when ${overtimeRecords.hours} is not null then 'hours' else 'days' end`,amount:sql<string|null>`null`}).from(overtimeRecords).innerJoin(employees,eq(employees.id,overtimeRecords.employeeId)).where(and(match(overtimeRecords.employeeId,overtimeRecords.overtimeDate),gte(overtimeRecords.overtimeDate,period.startDate),lte(overtimeRecords.overtimeDate,period.endDate))).orderBy(overtimeRecords.overtimeDate,overtimeRecords.id);
    if(kind==="debt")return executor.select({...employee,id:debtTransactions.id,date:debtTransactions.transactionDate,status:debtTransactions.transactionKind,quantity:sql<string|null>`null`,amount:debtTransactions.amount}).from(debtTransactions).innerJoin(employees,eq(employees.id,debtTransactions.employeeId)).where(and(match(debtTransactions.employeeId,debtTransactions.transactionDate),gte(debtTransactions.transactionDate,period.startDate),lte(debtTransactions.transactionDate,period.endDate))).orderBy(debtTransactions.transactionDate,debtTransactions.id);
    return executor.select({...employee,id:payrollRecords.id,date:payrollPeriods.endDate,status:payrollRecords.status,quantity:sql<string|null>`null`,amount:payrollRecords.netPay}).from(payrollRecords).innerJoin(payrollPeriods,eq(payrollPeriods.id,payrollRecords.payrollPeriodId)).innerJoin(employees,eq(employees.id,payrollRecords.employeeId)).innerJoin(employmentAssignments,eq(employmentAssignments.id,payrollRecords.employmentAssignmentId)).where(and(eq(payrollRecords.payrollPeriodId,period.id),filters.branchId ? eq(employmentAssignments.branchId,id(filters.branchId)):undefined,filters.departmentId ? eq(employmentAssignments.departmentId,id(filters.departmentId)):undefined)).orderBy(payrollRecords.id);
  },
  async summary(executor:DatabaseExecutor,period:typeof payrollPeriods.$inferSelect,filters:ReportFilters={}) {
    const matchingAssignment=(employee:AnyPgColumn,date:AnyPgColumn,snapshotBranch?:AnyPgColumn)=>assignmentMatch(executor,period.shopId,filters,employee,date,snapshotBranch);
    const [attendance,leave,overtime,debt,payroll]=await Promise.all([
      executor.select({status:workDayRecords.status,count:count()}).from(workDayRecords).where(and(matchingAssignment(workDayRecords.employeeId,workDayRecords.workDate,workDayRecords.branchId),gte(workDayRecords.workDate,period.startDate),lte(workDayRecords.workDate,period.endDate))).groupBy(workDayRecords.status),
      executor.select({status:leaveRequests.status,count:countDistinct(leaveRequests.id),days:sum(leaveRequestDays.dayAmount)}).from(leaveRequests).innerJoin(leaveRequestDays,eq(leaveRequestDays.leaveRequestId,leaveRequests.id)).where(and(matchingAssignment(leaveRequests.employeeId,leaveRequestDays.leaveDate),gte(leaveRequestDays.leaveDate,period.startDate),lte(leaveRequestDays.leaveDate,period.endDate))).groupBy(leaveRequests.status),
      executor.select({status:overtimeRecords.status,count:count(),hours:sum(overtimeRecords.hours),days:sum(overtimeRecords.dayUnits)}).from(overtimeRecords).where(and(matchingAssignment(overtimeRecords.employeeId,overtimeRecords.overtimeDate),gte(overtimeRecords.overtimeDate,period.startDate),lte(overtimeRecords.overtimeDate,period.endDate))).groupBy(overtimeRecords.status),
      executor.select({kind:debtTransactions.transactionKind,count:count(),amount:sum(debtTransactions.amount)}).from(debtTransactions).where(and(matchingAssignment(debtTransactions.employeeId,debtTransactions.transactionDate),gte(debtTransactions.transactionDate,period.startDate),lte(debtTransactions.transactionDate,period.endDate))).groupBy(debtTransactions.transactionKind),
      executor.select({status:payrollRecords.status,count:count(),earnings:sum(payrollRecords.totalEarnings),deductions:sum(payrollRecords.totalDeductions),net:sum(payrollRecords.netPay)}).from(payrollRecords).innerJoin(employmentAssignments,eq(employmentAssignments.id,payrollRecords.employmentAssignmentId)).where(and(eq(payrollRecords.payrollPeriodId,period.id),filters.branchId ? eq(employmentAssignments.branchId,id(filters.branchId)):undefined,filters.departmentId ? eq(employmentAssignments.departmentId,id(filters.departmentId)):undefined)).groupBy(payrollRecords.status),
    ]);
    return {period,attendance,leave,overtime,debt,payroll};
  },
  async lockedRows(executor: DatabaseExecutor, periodId: string, filters:ReportFilters={}) {
    return executor.select({
      recordId:payrollRecords.id, employeeId:employees.id, employeeCode:employees.employeeCode,
      employeeName:employees.firstName, employeeLastName:employees.lastName,
      branchId:employmentAssignments.branchId, branchName:branches.name, departmentId:employmentAssignments.departmentId,
      totalEarnings:payrollRecords.totalEarnings, totalDeductions:payrollRecords.totalDeductions, netPay:payrollRecords.netPay,
      // NULL legacy only: frozen daily earnings, never contractual salary or current membership.
      baseSalary:sql<string>`coalesce(${payrollRecords.socialSecurityBaseSnapshot}, (select sum(${payrollItems.amount}) from ${payrollItems} where ${payrollItems.payrollRecordId}=${payrollRecords.id} and ${payrollItems.itemType}='base_salary' and ${payrollItems.direction}='earning'),0)::numeric(12,2)::text`,
      socialSecurityDeduction:sql<string>`coalesce((select sum(${payrollItems.amount}) from ${payrollItems} where ${payrollItems.payrollRecordId}=${payrollRecords.id} and ${payrollItems.itemType}='social_security' and ${payrollItems.direction}='deduction'),0)::numeric(12,2)::text`,
      paymentStatus:payrollPayments.status, paymentMethod:payrollPayments.paymentMethod,
      accountHolder:payrollPayments.accountHolderNameSnapshot, accountCiphertext:payrollPayments.accountNumberCiphertextSnapshot, bankCode:payrollPayments.bankCodeSnapshot,
    }).from(payrollRecords)
      .innerJoin(payrollPeriods,eq(payrollPeriods.id,payrollRecords.payrollPeriodId))
      .innerJoin(employees,eq(employees.id,payrollRecords.employeeId))
      .innerJoin(employmentAssignments,eq(employmentAssignments.id,payrollRecords.employmentAssignmentId))
      .innerJoin(branches,eq(branches.id,employmentAssignments.branchId))
      .leftJoin(payrollPayments,and(eq(payrollPayments.payrollRecordId,payrollRecords.id),or(eq(payrollPayments.status,"prepared"),eq(payrollPayments.status,"paid"))))
      .where(and(eq(payrollRecords.payrollPeriodId,id(periodId)),eq(payrollRecords.status,"locked"),eq(payrollPeriods.status,"locked"),filters.branchId?eq(employmentAssignments.branchId,id(filters.branchId)):undefined,filters.departmentId?eq(employmentAssignments.departmentId,id(filters.departmentId)):undefined))
      .orderBy(branches.id,employees.employeeCode,payrollRecords.id);
  },
};
