import type { PayrollCalculatedRecord, PayrollCalculationInput, PayrollSourceItem } from "../payroll.types";
import { divideHalfUp, formatMoney, money, multiplyFixed, quantity, rate } from "./decimal";

const sourceTables = new Set([
  "work_day_records", "overtime_records", "advance_requests", "loan_installments",
  "debt_transactions", "payroll_adjustments", "employment_assignments", "leave_request_days",
]);

const fixedRateAmount = (baseCents: bigint, multiplier: string) =>
  multiplyFixed(baseCents, 2, rate(multiplier), 4, 2);

const dailyBase = (monthly: string, workDays: string) =>
  divideHalfUp(money(monthly) * 100n, quantity(workDays));

const line = (item: PayrollSourceItem): PayrollSourceItem => {
  if ((item.sourceTable === null) !== (item.sourceId === null) ||
      (item.sourceTable !== null && !sourceTables.has(item.sourceTable))) {
    throw new RangeError("Invalid payroll source");
  }
  money(item.amount);
  return item;
};

export const calculatePayroll = (input: PayrollCalculationInput): PayrollCalculatedRecord => {
  const items: PayrollSourceItem[] = [];
  for (const evidence of input.configurationEvidence ?? []) items.push(line({
    itemType: "other", direction: "earning", description: `Configuration ${evidence.key}`,
    quantity: null, rate: evidence.value, amount: "0.00", payrollConfigurationId: evidence.id,
    sourceTable: null, sourceId: null, occurredOn: evidence.effectiveOn,
  }));

  for (const day of input.workDays) {
    items.push(line({ itemType: "other", direction: "earning",
      description: `Attendance ${day.status}; late_minutes=${day.lateMinutes}; deductible=${day.deductible}`,
      quantity: null, rate: null, amount: "0.00", payrollConfigurationId: null,
      sourceTable: "work_day_records", sourceId: day.id, occurredOn: day.date }));
    const base = dailyBase(day.baseSalary ?? input.baseSalary, day.standardWorkDays ?? input.standardWorkDays);
    const welfare = dailyBase(day.welfare ?? input.welfare, day.standardWorkDays ?? input.standardWorkDays);
    const dayAssignmentId = day.assignmentId ?? input.assignmentId;
    items.push(line({ itemType: "base_salary", direction: "earning", description: "Daily base salary",
      quantity: "1.00", rate: formatMoney(base), amount: formatMoney(base),
      payrollConfigurationId: day.standardWorkDaysConfigurationId ?? null,
      sourceTable: "employment_assignments", sourceId: dayAssignmentId, occurredOn: day.date }));
    if (welfare > 0n) items.push(line({ itemType: "welfare", direction: "earning", description: "Daily welfare",
      quantity: "1.00", rate: formatMoney(welfare), amount: formatMoney(welfare),
      payrollConfigurationId: day.standardWorkDaysConfigurationId ?? null,
      sourceTable: "employment_assignments", sourceId: dayAssignmentId, occurredOn: day.date }));
    if (day.status === "absent" && day.deductible) {
      items.push(line({ itemType: "absence", direction: "deduction",
        description: "Absence", quantity: "1.00",
        rate: formatMoney(base), amount: formatMoney(fixedRateAmount(base, day.absenceRate ?? input.absenceRate)),
        payrollConfigurationId: day.absenceConfigurationId ?? null, sourceTable: "work_day_records", sourceId: day.id, occurredOn: day.date }));
    }
    if (day.status !== "leave" && day.lateMinutes > 0 && day.deductible) {
      const amount = multiplyFixed(BigInt(day.lateMinutes), 0, rate(day.lateRate ?? input.lateRate), 4, 2);
      items.push(line({ itemType: "lateness", direction: "deduction", description: "Lateness",
        quantity: `${day.lateMinutes}.00`, rate: day.lateRate ?? input.lateRate, amount: formatMoney(amount),
        payrollConfigurationId: day.lateConfigurationId ?? null, sourceTable: "work_day_records", sourceId: day.id, occurredOn: day.date }));
    }
  }

  for (const day of input.approvedLeaveEvidence ?? []) items.push(line({
    itemType: "other", direction: "earning", amount: "0.00", quantity: null, rate: null,
    description: `Approved leave request=${day.requestId}; original_type=${day.originalTypeId}; approved_type=${day.approvedTypeId}; paid=${day.paid}; deductible=${day.deductible}; quota_consumed=${day.quotaConsumed}`,
    payrollConfigurationId: null, sourceTable: "leave_request_days", sourceId: day.id, occurredOn: day.date,
  }));

  for (const overtime of input.overtime) {
    const base = dailyBase(overtime.baseSalary ?? input.baseSalary, overtime.standardWorkDays ?? input.standardWorkDays);
    const multiplier = rate(overtime.rate);
    const units = overtime.type === "hourly" ? quantity(overtime.hours ?? "0") : quantity(overtime.dayUnits ?? "0");
    const unitBase = overtime.type === "hourly" ? divideHalfUp(base, 8n) : base;
    const withUnits = multiplyFixed(unitBase, 2, units, 2, 2);
    const amount = multiplyFixed(withUnits, 2, multiplier, 4, 2);
    const itemType = overtime.type === "hourly" ? "overtime_hourly" : overtime.type === "rest_day" ? "overtime_rest_day" : "overtime_public_holiday";
    items.push(line({ itemType, direction: "earning", description: `Approved ${overtime.type} overtime`,
      quantity: overtime.hours ?? overtime.dayUnits, rate: overtime.rate, amount: formatMoney(amount),
      payrollConfigurationId: overtime.configurationId, sourceTable: "overtime_records", sourceId: overtime.id, occurredOn: overtime.date }));
  }

  const earnedBase = items.filter((item) => item.itemType === "base_salary")
    .reduce((sum, item) => sum + money(item.amount), 0n);
  const socialBase = fixedRateAmount(earnedBase, input.socialSecurityRate);
  const social = socialBase < money(input.socialSecurityCap) ? socialBase : money(input.socialSecurityCap);
  if (social > 0n) items.push(line({ itemType: "social_security", direction: "deduction", description: "Social security",
    quantity: null, rate: input.socialSecurityRate, amount: formatMoney(social), payrollConfigurationId: input.socialSecurityRateConfigurationId ?? null,
    sourceTable: null, sourceId: null, occurredOn: null }));

  for (const deduction of input.deductions) items.push(line({
    itemType: deduction.type, direction: "deduction", description: deduction.description,
    quantity: null, rate: null, amount: formatMoney(money(deduction.amount)), payrollConfigurationId: null,
    sourceTable: deduction.type === "advance" ? "advance_requests" : deduction.type === "loan_installment" ? "loan_installments" : "debt_transactions",
    sourceId: deduction.id, occurredOn: deduction.date,
  }));
  for (const adjustment of input.adjustments) items.push(line({
    itemType: "adjustment", direction: adjustment.direction, description: adjustment.reason,
    quantity: null, rate: null, amount: formatMoney(money(adjustment.amount)), payrollConfigurationId: null,
    sourceTable: "payroll_adjustments", sourceId: adjustment.id, occurredOn: null,
  }));

  const earnings = items.filter((item) => item.direction === "earning").reduce((sum, item) => sum + money(item.amount), 0n);
  const deductions = items.filter((item) => item.direction === "deduction").reduce((sum, item) => sum + money(item.amount), 0n);
  return {
    employeeId: input.employeeId, assignmentId: input.assignmentId, branchId: input.branchId,
    baseSalarySnapshot: formatMoney(money(input.baseSalary)), welfareSnapshot: formatMoney(money(input.welfare)),
    totalEarnings: formatMoney(earnings), totalDeductions: formatMoney(deductions), netPay: formatMoney(earnings - deductions), items,
  };
};

export const payrollRecordTotalsReconcile = (record: PayrollCalculatedRecord): boolean => {
  const earnings = record.items.filter((item) => item.direction === "earning")
    .reduce((sum, item) => sum + money(item.amount), 0n);
  const deductions = record.items.filter((item) => item.direction === "deduction")
    .reduce((sum, item) => sum + money(item.amount), 0n);
  return earnings === money(record.totalEarnings) && deductions === money(record.totalDeductions) &&
    earnings - deductions === money(record.netPay);
};

export const isPayrollSourceTable = (value: string) => sourceTables.has(value);
