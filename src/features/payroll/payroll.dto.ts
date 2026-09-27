import type { PayrollAdjustmentStatus, PayrollConfigurationKey, PayrollDirection, PayrollPeriodStatus } from "./payroll.types";

export interface PayrollConfigurationRequestDto {
  shop_id: string;
  branch_id?: string | null;
  config_key: string;
  numeric_value: string;
  unit: string;
  effective_from: string;
  effective_to?: string | null;
}

export interface PayrollPeriodRequestDto {
  shop_id: string;
  period_year: number;
  period_month: number;
  start_date: string;
  end_date: string;
}

export interface PayrollAdjustmentRequestDto {
  original_payroll_record_id: string;
  applied_payroll_period_id: string;
  direction: PayrollDirection;
  amount: string;
  reason: string;
}

export interface PayrollConfigurationResponseDto {
  id: string;
  shop_id: string;
  branch_id: string | null;
  config_key: PayrollConfigurationKey;
  numeric_value: string;
  unit: string;
  effective_from: string;
  effective_to: string | null;
}

export interface PayrollPeriodResponseDto {
  id: string;
  shop_id: string;
  period_year: number;
  period_month: number;
  start_date: string;
  end_date: string;
  status: PayrollPeriodStatus;
  previewed_at: string | null;
  locked_by_user_account_id: string | null;
  locked_at: string | null;
}

export interface PayrollItemResponseDto {
  item_type: string;
  direction: PayrollDirection;
  description: string;
  quantity: string | null;
  rate: string | null;
  amount: string;
  payroll_configuration_id: string | null;
  source_table: string | null;
  source_id: string | null;
  occurred_on: string | null;
}

export interface PayrollRecordResponseDto {
  id?: string;
  payroll_period_id?: string;
  status?: string;
  employee_id: string;
  employment_assignment_id: string;
  branch_id: string;
  base_salary_snapshot: string;
  welfare_snapshot: string;
  total_earnings: string;
  total_deductions: string;
  net_pay: string;
  items: PayrollItemResponseDto[];
}

export interface PayrollAdjustmentResponseDto {
  id: string;
  original_payroll_record_id: string;
  applied_payroll_period_id: string | null;
  direction: PayrollDirection;
  amount: string;
  reason: string;
  status: PayrollAdjustmentStatus;
  requested_by_user_account_id: string;
  requested_at: string;
  approved_by_user_account_id: string | null;
  approved_at: string | null;
  applied_payroll_item_id: string | null;
}
