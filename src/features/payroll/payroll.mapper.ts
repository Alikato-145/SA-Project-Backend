import type {
  PayrollAdjustmentResponseDto,
  PayrollConfigurationResponseDto,
  PayrollPeriodResponseDto,
  PayrollRecordResponseDto,
} from "./payroll.dto";
import type {
  PayrollAdjustmentRecord,
  PayrollCalculatedRecord,
  PayrollConfigurationRecord,
  PayrollPeriodRecord,
} from "./payroll.types";
import type { PayrollRecordDetail } from "./payroll.types";

export const toPayrollConfigurationResponseDto = (record: PayrollConfigurationRecord): PayrollConfigurationResponseDto => ({
  id: record.id, shop_id: record.shopId, branch_id: record.branchId, config_key: record.configKey,
  numeric_value: record.numericValue, unit: record.unit, effective_from: record.effectiveFrom, effective_to: record.effectiveTo,
});

export const toPayrollPeriodResponseDto = (period: PayrollPeriodRecord): PayrollPeriodResponseDto => ({
  id: period.id, shop_id: period.shopId, period_year: period.periodYear, period_month: period.periodMonth,
  start_date: period.startDate, end_date: period.endDate, status: period.status,
  previewed_at: period.previewedAt?.toISOString() ?? null,
  locked_by_user_account_id: period.lockedByUserAccountId,
  locked_at: period.lockedAt?.toISOString() ?? null,
});

export const toPayrollRecordResponseDto = (record: PayrollCalculatedRecord | PayrollRecordDetail): PayrollRecordResponseDto => ({
  ...(recordHasIdentity(record) ? { id: record.id, payroll_period_id: record.periodId, status: record.status } : {}),
  employee_id: record.employeeId, employment_assignment_id: record.assignmentId, branch_id: record.branchId,
  base_salary_snapshot: record.baseSalarySnapshot, welfare_snapshot: record.welfareSnapshot,
  total_earnings: record.totalEarnings, total_deductions: record.totalDeductions, net_pay: record.netPay,
  items: record.items.map((item) => ({
    item_type: item.itemType, direction: item.direction, description: item.description,
    quantity: item.quantity, rate: item.rate, amount: item.amount,
    payroll_configuration_id: item.payrollConfigurationId, source_table: item.sourceTable,
    source_id: item.sourceId, occurred_on: item.occurredOn,
  })),
});

const recordHasIdentity = (record: PayrollCalculatedRecord | PayrollRecordDetail): record is PayrollRecordDetail =>
  "id" in record;

export const toPayrollAdjustmentResponseDto = (record: PayrollAdjustmentRecord): PayrollAdjustmentResponseDto => ({
  id: record.id, original_payroll_record_id: record.originalPayrollRecordId,
  applied_payroll_period_id: record.appliedPayrollPeriodId, direction: record.direction,
  amount: record.amount, reason: record.reason, status: record.status,
  requested_by_user_account_id: record.requestedByUserAccountId, requested_at: record.requestedAt.toISOString(),
  approved_by_user_account_id: record.approvedByUserAccountId,
  approved_at: record.approvedAt?.toISOString() ?? null, applied_payroll_item_id: record.appliedPayrollItemId,
});
