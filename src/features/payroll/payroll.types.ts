import type { AuthenticatedActor } from "../../core/auth/auth.types";

export const payrollConfigurationUnits = {
  STANDARD_WORK_DAYS: "days",
  ABSENCE_RATE: "multiplier",
  LATE_RATE: "currency_per_minute",
  OT_HOURLY_RATE: "multiplier",
  OT_REST_DAY_RATE: "multiplier",
  OT_PUBLIC_HOLIDAY_RATE: "multiplier",
  SOCIAL_SECURITY_RATE: "ratio",
  SOCIAL_SECURITY_CAP: "currency",
} as const;

export type PayrollConfigurationKey = keyof typeof payrollConfigurationUnits;
export type PayrollPeriodStatus = "draft" | "previewed" | "locked";
export type PayrollRecordStatus = "draft" | "calculated" | "locked";
export type PayrollDirection = "earning" | "deduction";
export type PayrollAdjustmentStatus = "pending" | "approved" | "rejected" | "applied";
export type PayrollActor = AuthenticatedActor;

export interface PayrollConfigurationRecord {
  id: string;
  shopId: string;
  branchId: string | null;
  configKey: PayrollConfigurationKey;
  numericValue: string;
  unit: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdByUserAccountId: string;
}

export interface PayrollPeriodRecord {
  id: string;
  shopId: string;
  periodYear: number;
  periodMonth: number;
  startDate: string;
  endDate: string;
  status: PayrollPeriodStatus;
  createdByUserAccountId: string;
  previewedAt: Date | null;
  lockedByUserAccountId: string | null;
  lockedAt: Date | null;
}

export interface PayrollSourceItem {
  itemType: "base_salary" | "welfare" | "overtime_rest_day" | "overtime_hourly" |
    "overtime_public_holiday" | "absence" | "lateness" | "sick_unpaid" |
    "social_security" | "advance" | "loan_installment" | "debt" | "adjustment" | "other";
  direction: PayrollDirection;
  description: string;
  quantity: string | null;
  rate: string | null;
  amount: string;
  payrollConfigurationId: string | null;
  sourceTable: string | null;
  sourceId: string | null;
  occurredOn: string | null;
}

export interface PayrollCalculationInput {
  employeeId: string;
  employeeCode: string;
  assignmentId: string;
  branchId: string;
  baseSalary: string;
  welfare: string;
  standardWorkDays: string;
  absenceRate: string;
  lateRate: string;
  socialSecurityRate: string;
  socialSecurityCap: string;
  socialSecurityRateConfigurationId?: string;
  configurationEvidence?: readonly {
    id: string;
    key: PayrollConfigurationKey;
    value: string;
    effectiveOn: string;
  }[];
  workDays: readonly {
    id: string;
    date: string;
    status: "present" | "late" | "absent" | "leave" | "weekly_holiday" | "public_holiday";
    lateMinutes: number;
    deductible: boolean;
    assignmentId?: string;
    baseSalary?: string;
    welfare?: string;
    standardWorkDays?: string;
    standardWorkDaysConfigurationId?: string;
    absenceRate?: string;
    lateRate?: string;
    absenceConfigurationId?: string;
    lateConfigurationId?: string;
  }[];
  approvedLeaveEvidence?: readonly {
    id: string; requestId: string; date: string; originalTypeId: string; approvedTypeId: string;
    paid: boolean; deductible: boolean; quotaConsumed: string;
  }[];
  overtime: readonly {
    id: string;
    date: string;
    type: "hourly" | "rest_day" | "public_holiday";
    hours: string | null;
    dayUnits: string | null;
    rate: string;
    configurationId: string | null;
    baseSalary?: string;
    standardWorkDays?: string;
  }[];
  deductions: readonly {
    id: string;
    type: "advance" | "loan_installment" | "debt";
    amount: string;
    description: string;
    date: string | null;
  }[];
  adjustments: readonly {
    id: string;
    direction: PayrollDirection;
    amount: string;
    reason: string;
  }[];
}

export interface PayrollBlocker {
  code: "PAYROLL_CONFIGURATION_MISSING" | "PAYROLL_ATTENDANCE_INCOMPLETE" |
    "PAYROLL_APPROVALS_PENDING" | "PAYROLL_ASSIGNMENT_MISSING" |
    "PAYROLL_NEGATIVE_NET_PAY" | "PAYROLL_TOTAL_MISMATCH";
  employeeId: string | null;
  detail: string;
}

export interface PayrollCalculatedRecord {
  employeeId: string;
  assignmentId: string;
  branchId: string;
  baseSalarySnapshot: string;
  welfareSnapshot: string;
  totalEarnings: string;
  totalDeductions: string;
  netPay: string;
  items: PayrollSourceItem[];
}

export interface PayrollRecordDetail extends PayrollCalculatedRecord {
  id: string;
  periodId: string;
  status: PayrollRecordStatus;
}

export interface PayrollPeriodDetail {
  period: PayrollPeriodRecord;
  records: PayrollRecordDetail[];
  blockers: PayrollBlocker[];
}

export interface PayrollPreviewResult {
  period: PayrollPeriodRecord;
  records: PayrollCalculatedRecord[];
  blockers: PayrollBlocker[];
}

export interface CreatePayrollConfigurationCommand {
  actor: PayrollActor;
  requestId: string;
  shopId: string;
  branchId: string | null;
  configKey: PayrollConfigurationKey;
  numericValue: string;
  unit: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface CreatePayrollPeriodCommand {
  actor: PayrollActor;
  requestId: string;
  shopId: string;
  periodYear: number;
  periodMonth: number;
  startDate: string;
  endDate: string;
}

export interface PayrollAdjustmentRecord {
  id: string;
  originalPayrollRecordId: string;
  appliedPayrollPeriodId: string | null;
  direction: PayrollDirection;
  amount: string;
  reason: string;
  status: PayrollAdjustmentStatus;
  requestedByUserAccountId: string;
  requestedAt: Date;
  approvedByUserAccountId: string | null;
  approvedAt: Date | null;
  appliedPayrollItemId: string | null;
}
