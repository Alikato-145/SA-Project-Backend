export const roleScopeValues = ["self", "department", "branch", "all"] as const;
export const employeeStatusValues = [
  "active",
  "inactive",
  "suspended",
  "terminated",
] as const;
export const accountStatusValues = ["active", "locked", "disabled"] as const;
export const employmentTypeValues = [
  "full_time",
  "part_time",
  "temporary",
] as const;
export const workDayStatusValues = [
  "present",
  "late",
  "absent",
  "leave",
  "weekly_holiday",
  "public_holiday",
] as const;
export const timeEntrySourceValues = ["manual", "import", "biometric"] as const;
export const quotaTypeValues = ["fixed", "by_seniority", "none"] as const;
export const leaveRequestStatusValues = [
  "draft",
  "pending",
  "approved",
  "rejected",
  "cancelled",
] as const;
export const approvalActionTypeValues = [
  "submitted",
  "forwarded",
  "approved",
  "rejected",
  "overridden",
  "type_changed",
  "cancelled",
] as const;
export const overtimeTypeValues = [
  "rest_day",
  "hourly",
  "public_holiday",
] as const;
export const overtimeStatusValues = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
] as const;
export const advanceStatusValues = [
  "pending",
  "approved",
  "rejected",
  "deducted",
  "cancelled",
] as const;
export const loanStatusValues = ["active", "closed", "cancelled"] as const;
export const installmentStatusValues = [
  "scheduled",
  "deducted",
  "waived",
  "cancelled",
] as const;
export const debtTransactionKindValues = [
  "charge",
  "adjustment",
  "reversal",
] as const;
export const payrollPeriodStatusValues = [
  "draft",
  "previewed",
  "locked",
] as const;
export const payrollRecordStatusValues = [
  "draft",
  "calculated",
  "locked",
] as const;
export const payrollItemDirectionValues = ["earning", "deduction"] as const;
export const payrollItemTypeValues = [
  "base_salary",
  "welfare",
  "overtime_rest_day",
  "overtime_hourly",
  "overtime_public_holiday",
  "absence",
  "lateness",
  "sick_unpaid",
  "social_security",
  "advance",
  "loan_installment",
  "debt",
  "adjustment",
  "other",
] as const;
export const payrollAdjustmentStatusValues = [
  "pending",
  "approved",
  "rejected",
  "applied",
] as const;
export const payslipStatusValues = ["generated", "voided"] as const;
export const emailDeliveryStatusValues = ["pending", "sent", "failed"] as const;
