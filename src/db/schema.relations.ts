// Runtime relation metadata stays separate from feature-owned table definitions.
import { relations } from "drizzle-orm";
import { advanceRequests } from "../features/advance/advance.schema";
import { attachments } from "../features/attachment/attachment.schema";
import { workDayRecords } from "../features/attendance/attendance.schema";
import { auditLogs } from "../features/audit/audit.schema";
import { branches } from "../features/branch/branch.schema";
import { branchSchedules, branchScheduleOverrides } from "../features/branch-schedule/branch-schedule.schema";
import { debtTypes, debtTransactions } from "../features/debt/debt.schema";
import { departments } from "../features/department/department.schema";
import { employeeBankAccounts } from "../features/employee-bank-account/employee-bank-account.schema";
import { employeeWeeklyHolidays } from "../features/employee-weekly-holiday/employee-weekly-holiday.schema";
import { employees } from "../features/employee/employee.schema";
import { employmentAssignments } from "../features/employment-assignment/employment-assignment.schema";
import { holidayCalendars } from "../features/holiday-calendar/holiday-calendar.schema";
import { leaveApprovalActions, leaveQuotas, leaveRequestDays, leaveRequests, leaveTypes } from "../features/leave/leave.schema";
import { loanInstallments, loans } from "../features/loan/loan.schema";
import { overtimeApprovalActions, overtimeRecords } from "../features/overtime/overtime.schema";
import { payrollAdjustments, payrollConfigurations, payrollItems, payrollPeriods, payrollRecords } from "../features/payroll/payroll.schema";
import { emailDeliveryLogs, payslips } from "../features/payslip/payslip.schema";
import { positions } from "../features/position/position.schema";
import { roles } from "../features/role/role.schema";
import { shops } from "../features/shop/shop.schema";
import { userAccountRoles, userAccounts } from "../features/user-account/user-account.schema";

export const shopsRelations = relations(shops, ({ many }) => ({
  branches: many(branches),
  positions: many(positions),
  holidays: many(holidayCalendars),
  payrollConfigurations: many(payrollConfigurations),
  payrollPeriods: many(payrollPeriods),
}));

export const employeesRelations = relations(employees, ({ many, one }) => ({
  userAccount: one(userAccounts),
  employmentAssignments: many(employmentAssignments),
  bankAccounts: many(employeeBankAccounts),
  weeklyHolidays: many(employeeWeeklyHolidays),
  workDays: many(workDayRecords),
  leaveRequests: many(leaveRequests),
  leaveQuotas: many(leaveQuotas),
  overtimeRecords: many(overtimeRecords),
  advanceRequests: many(advanceRequests),
  loans: many(loans),
  debtTransactions: many(debtTransactions),
  payrollRecords: many(payrollRecords),
  attachments: many(attachments),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  accountRoles: many(userAccountRoles),
}));

export const leaveTypesRelations = relations(leaveTypes, ({ many }) => ({
  requestedLeaveRequests: many(leaveRequests, { relationName: "requestedLeaveType" }),
  finalLeaveRequests: many(leaveRequests, { relationName: "finalLeaveType" }),
  leaveRequestDays: many(leaveRequestDays),
  leaveQuotas: many(leaveQuotas),
  changedFromActions: many(leaveApprovalActions, { relationName: "fromLeaveType" }),
  changedToActions: many(leaveApprovalActions, { relationName: "toLeaveType" }),
}));

export const debtTypesRelations = relations(debtTypes, ({ many }) => ({
  transactions: many(debtTransactions),
}));

export const branchesRelations = relations(branches, ({ one }) => ({
  shop: one(shops, { fields: [branches.shopId], references: [shops.id] }),
}));

export const departmentsRelations = relations(departments, ({ one }) => ({
  branch: one(branches, { fields: [departments.branchId], references: [branches.id] }),
}));

export const positionsRelations = relations(positions, ({ one }) => ({
  shop: one(shops, { fields: [positions.shopId], references: [shops.id] }),
}));

export const userAccountsRelations = relations(userAccounts, ({ one }) => ({
  employee: one(employees, { fields: [userAccounts.employeeId], references: [employees.id] }),
}));

export const userAccountRolesRelations = relations(userAccountRoles, ({ one }) => ({
  userAccount: one(userAccounts, { fields: [userAccountRoles.userAccountId], references: [userAccounts.id], relationName: "accountRoles" }),
  role: one(roles, { fields: [userAccountRoles.roleId], references: [roles.id] }),
  branch: one(branches, { fields: [userAccountRoles.branchId], references: [branches.id] }),
  department: one(departments, { fields: [userAccountRoles.departmentId], references: [departments.id] }),
  grantedBy: one(userAccounts, { fields: [userAccountRoles.grantedByUserAccountId], references: [userAccounts.id], relationName: "grantedRoles" }),
}));

export const employmentAssignmentsRelations = relations(employmentAssignments, ({ one }) => ({
  employee: one(employees, { fields: [employmentAssignments.employeeId], references: [employees.id] }),
  branch: one(branches, { fields: [employmentAssignments.branchId], references: [branches.id] }),
  department: one(departments, { fields: [employmentAssignments.departmentId], references: [departments.id] }),
  position: one(positions, { fields: [employmentAssignments.positionId], references: [positions.id] }),
  createdBy: one(userAccounts, { fields: [employmentAssignments.createdByUserAccountId], references: [userAccounts.id] }),
}));

export const employeeBankAccountsRelations = relations(employeeBankAccounts, ({ one }) => ({
  employee: one(employees, { fields: [employeeBankAccounts.employeeId], references: [employees.id] }),
}));

export const employeeWeeklyHolidaysRelations = relations(employeeWeeklyHolidays, ({ one }) => ({
  employee: one(employees, { fields: [employeeWeeklyHolidays.employeeId], references: [employees.id] }),
}));

export const branchSchedulesRelations = relations(branchSchedules, ({ one }) => ({
  branch: one(branches, { fields: [branchSchedules.branchId], references: [branches.id] }),
}));

export const branchScheduleOverridesRelations = relations(branchScheduleOverrides, ({ one }) => ({
  branch: one(branches, { fields: [branchScheduleOverrides.branchId], references: [branches.id] }),
  createdBy: one(userAccounts, { fields: [branchScheduleOverrides.createdByUserAccountId], references: [userAccounts.id] }),
}));

export const holidayCalendarsRelations = relations(holidayCalendars, ({ one }) => ({
  shop: one(shops, { fields: [holidayCalendars.shopId], references: [shops.id] }),
  createdBy: one(userAccounts, { fields: [holidayCalendars.createdByUserAccountId], references: [userAccounts.id] }),
}));

export const workDayRecordsRelations = relations(workDayRecords, ({ one }) => ({
  employee: one(employees, { fields: [workDayRecords.employeeId], references: [employees.id] }),
  branchSnapshot: one(branches, { fields: [workDayRecords.branchId], references: [branches.id] }),
  createdBy: one(userAccounts, { fields: [workDayRecords.createdByUserAccountId], references: [userAccounts.id] }),
}));

export const leaveRequestsRelations = relations(leaveRequests, ({ one }) => ({
  employee: one(employees, { fields: [leaveRequests.employeeId], references: [employees.id] }),
  requestedLeaveType: one(leaveTypes, { fields: [leaveRequests.originalLeaveTypeId], references: [leaveTypes.id], relationName: "requestedLeaveType" }),
  finalLeaveType: one(leaveTypes, { fields: [leaveRequests.finalLeaveTypeId], references: [leaveTypes.id], relationName: "finalLeaveType" }),
  submittedBy: one(userAccounts, { fields: [leaveRequests.submittedByUserAccountId], references: [userAccounts.id] }),
}));

export const leaveRequestDaysRelations = relations(leaveRequestDays, ({ one }) => ({
  leaveRequest: one(leaveRequests, { fields: [leaveRequestDays.leaveRequestId], references: [leaveRequests.id] }),
  workDayRecord: one(workDayRecords, { fields: [leaveRequestDays.workDayRecordId], references: [workDayRecords.id] }),
  leaveType: one(leaveTypes, { fields: [leaveRequestDays.leaveTypeId], references: [leaveTypes.id] }),
}));

export const leaveQuotasRelations = relations(leaveQuotas, ({ one }) => ({
  employee: one(employees, { fields: [leaveQuotas.employeeId], references: [employees.id] }),
  leaveType: one(leaveTypes, { fields: [leaveQuotas.leaveTypeId], references: [leaveTypes.id] }),
}));

export const leaveApprovalActionsRelations = relations(leaveApprovalActions, ({ one }) => ({
  leaveRequest: one(leaveRequests, { fields: [leaveApprovalActions.leaveRequestId], references: [leaveRequests.id] }),
  actor: one(userAccounts, { fields: [leaveApprovalActions.actorUserAccountId], references: [userAccounts.id] }),
  fromLeaveType: one(leaveTypes, { fields: [leaveApprovalActions.fromLeaveTypeId], references: [leaveTypes.id], relationName: "fromLeaveType" }),
  toLeaveType: one(leaveTypes, { fields: [leaveApprovalActions.toLeaveTypeId], references: [leaveTypes.id], relationName: "toLeaveType" }),
}));

export const overtimeRecordsRelations = relations(overtimeRecords, ({ one }) => ({
  employee: one(employees, { fields: [overtimeRecords.employeeId], references: [employees.id] }),
  workDayRecord: one(workDayRecords, { fields: [overtimeRecords.workDayRecordId], references: [workDayRecords.id] }),
  requestedBy: one(userAccounts, { fields: [overtimeRecords.requestedByUserAccountId], references: [userAccounts.id] }),
}));

export const overtimeApprovalActionsRelations = relations(overtimeApprovalActions, ({ one }) => ({
  overtimeRecord: one(overtimeRecords, { fields: [overtimeApprovalActions.overtimeRecordId], references: [overtimeRecords.id] }),
  actor: one(userAccounts, { fields: [overtimeApprovalActions.actorUserAccountId], references: [userAccounts.id] }),
}));

export const advanceRequestsRelations = relations(advanceRequests, ({ one }) => ({
  employee: one(employees, { fields: [advanceRequests.employeeId], references: [employees.id] }),
  requestedBy: one(userAccounts, { fields: [advanceRequests.requestedByUserAccountId], references: [userAccounts.id] }),
  decidedBy: one(userAccounts, { fields: [advanceRequests.decidedByUserAccountId], references: [userAccounts.id] }),
}));

export const loansRelations = relations(loans, ({ one }) => ({
  employee: one(employees, { fields: [loans.employeeId], references: [employees.id] }),
  approvedBy: one(userAccounts, { fields: [loans.approvedByUserAccountId], references: [userAccounts.id] }),
}));

export const loanInstallmentsRelations = relations(loanInstallments, ({ one }) => ({
  loan: one(loans, { fields: [loanInstallments.loanId], references: [loans.id] }),
  payrollRecord: one(payrollRecords, { fields: [loanInstallments.payrollRecordId], references: [payrollRecords.id] }),
}));

export const debtTransactionsRelations = relations(debtTransactions, ({ one }) => ({
  employee: one(employees, { fields: [debtTransactions.employeeId], references: [employees.id] }),
  debtType: one(debtTypes, { fields: [debtTransactions.debtTypeId], references: [debtTypes.id] }),
  recordedBy: one(userAccounts, { fields: [debtTransactions.recordedByUserAccountId], references: [userAccounts.id] }),
  payrollRecord: one(payrollRecords, { fields: [debtTransactions.settledInPayrollRecordId], references: [payrollRecords.id] }),
  originalTransaction: one(debtTransactions, { fields: [debtTransactions.originalTransactionId], references: [debtTransactions.id] }),
}));

export const payrollConfigurationsRelations = relations(payrollConfigurations, ({ one }) => ({
  shop: one(shops, { fields: [payrollConfigurations.shopId], references: [shops.id] }),
  branch: one(branches, { fields: [payrollConfigurations.branchId], references: [branches.id] }),
  createdBy: one(userAccounts, { fields: [payrollConfigurations.createdByUserAccountId], references: [userAccounts.id] }),
}));

export const payrollPeriodsRelations = relations(payrollPeriods, ({ one }) => ({
  shop: one(shops, { fields: [payrollPeriods.shopId], references: [shops.id] }),
  createdBy: one(userAccounts, { fields: [payrollPeriods.createdByUserAccountId], references: [userAccounts.id] }),
  lockedBy: one(userAccounts, { fields: [payrollPeriods.lockedByUserAccountId], references: [userAccounts.id] }),
}));

export const payrollRecordsRelations = relations(payrollRecords, ({ one }) => ({
  payrollPeriod: one(payrollPeriods, { fields: [payrollRecords.payrollPeriodId], references: [payrollPeriods.id] }),
  employee: one(employees, { fields: [payrollRecords.employeeId], references: [employees.id] }),
  assignmentSnapshot: one(employmentAssignments, { fields: [payrollRecords.employmentAssignmentId], references: [employmentAssignments.id] }),
  calculatedBy: one(userAccounts, { fields: [payrollRecords.calculatedByUserAccountId], references: [userAccounts.id] }),
}));

export const payrollItemsRelations = relations(payrollItems, ({ one }) => ({
  payrollRecord: one(payrollRecords, { fields: [payrollItems.payrollRecordId], references: [payrollRecords.id] }),
  payrollConfiguration: one(payrollConfigurations, { fields: [payrollItems.payrollConfigurationId], references: [payrollConfigurations.id] }),
}));

export const payrollAdjustmentsRelations = relations(payrollAdjustments, ({ one }) => ({
  originalPayrollRecord: one(payrollRecords, { fields: [payrollAdjustments.originalPayrollRecordId], references: [payrollRecords.id] }),
  appliedPayrollPeriod: one(payrollPeriods, { fields: [payrollAdjustments.appliedPayrollPeriodId], references: [payrollPeriods.id] }),
  requestedBy: one(userAccounts, { fields: [payrollAdjustments.requestedByUserAccountId], references: [userAccounts.id] }),
  approvedBy: one(userAccounts, { fields: [payrollAdjustments.approvedByUserAccountId], references: [userAccounts.id] }),
  appliedPayrollItem: one(payrollItems, { fields: [payrollAdjustments.appliedPayrollItemId], references: [payrollItems.id] }),
}));

export const payslipsRelations = relations(payslips, ({ one }) => ({
  payrollRecord: one(payrollRecords, { fields: [payslips.payrollRecordId], references: [payrollRecords.id] }),
  generatedBy: one(userAccounts, { fields: [payslips.generatedByUserAccountId], references: [userAccounts.id] }),
  voidedBy: one(userAccounts, { fields: [payslips.voidedByUserAccountId], references: [userAccounts.id] }),
}));

export const emailDeliveryLogsRelations = relations(emailDeliveryLogs, ({ one }) => ({
  payslip: one(payslips, { fields: [emailDeliveryLogs.payslipId], references: [payslips.id] }),
}));

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  employee: one(employees, { fields: [attachments.employeeId], references: [employees.id] }),
  leaveRequest: one(leaveRequests, { fields: [attachments.leaveRequestId], references: [leaveRequests.id] }),
  uploadedBy: one(userAccounts, { fields: [attachments.uploadedByUserAccountId], references: [userAccounts.id] }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actor: one(userAccounts, { fields: [auditLogs.actorUserAccountId], references: [userAccounts.id] }),
}));
