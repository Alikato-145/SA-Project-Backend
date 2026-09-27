import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { ApplicationError } from "../../core/errors/application.error";
import type { PayrollAdjustmentRequestDto, PayrollConfigurationRequestDto, PayrollPeriodRequestDto } from "./payroll.dto";
import { toPayrollAdjustmentResponseDto, toPayrollConfigurationResponseDto, toPayrollPeriodResponseDto, toPayrollRecordResponseDto } from "./payroll.mapper";
import { payrollConfigurationUnits, type PayrollAdjustmentRecord, type PayrollAdjustmentStatus, type PayrollConfigurationKey, type PayrollConfigurationRecord, type PayrollPeriodDetail, type PayrollPeriodRecord, type PayrollPeriodStatus, type PayrollPreviewResult, type PayrollRecordDetail } from "./payroll.types";
import { assertPayrollRange, parsePayrollConfigurationKey, parsePayrollDate, parsePayrollDecimal, parsePayrollId } from "./payroll.validation";

export interface PayrollControllerService {
  getPayrollAccess(actor: AuthenticatedActor): { canMutate: boolean; readableBranchIds: readonly string[] | null };
  createPayrollConfiguration(command: Parameters<typeof parseConfigurationCommand>[0] extends never ? never : ReturnType<typeof parseConfigurationCommand>): Promise<PayrollConfigurationRecord>;
  listPayrollConfigurations(actor: AuthenticatedActor, shopId: string, filters?: { branchId?: string; configKey?: PayrollConfigurationKey; onDate?: string; page?: number; pageSize?: number }, requestId?: string): Promise<PayrollConfigurationRecord[]>;
  createPayrollPeriod(command: ReturnType<typeof parsePeriodCommand>): Promise<PayrollPeriodRecord>;
  listPayrollPeriods(actor: AuthenticatedActor, shopId: string, filters?: { year?: number; status?: PayrollPeriodStatus; page?: number; pageSize?: number }, requestId?: string): Promise<PayrollPeriodRecord[]>;
  getPayrollPeriod(actor: AuthenticatedActor, periodId: string, requestId?: string): Promise<PayrollPeriodDetail>;
  getPayrollRecord(actor: AuthenticatedActor, periodId: string, recordId: string, requestId?: string): Promise<PayrollRecordDetail>;
  previewPayrollPeriod(actor: AuthenticatedActor, periodId: string, requestId: string): Promise<PayrollPreviewResult>;
  lockPayrollPeriod(actor: AuthenticatedActor, periodId: string, requestId: string): Promise<PayrollPreviewResult>;
  requestPayrollAdjustment(command: ReturnType<typeof parseAdjustmentCommand>): Promise<PayrollAdjustmentRecord>;
  decidePayrollAdjustment(actor: AuthenticatedActor, adjustmentId: string, decision: "approved" | "rejected", requestId: string): Promise<PayrollAdjustmentRecord>;
  listPayrollAdjustments(actor: AuthenticatedActor, filters?: { recordId?: string; periodId?: string; status?: PayrollAdjustmentStatus; page?: number; pageSize?: number }, requestId?: string): Promise<PayrollAdjustmentRecord[]>;
}

const parseConfigurationCommand = (input: { actor: AuthenticatedActor; requestId: string; body: PayrollConfigurationRequestDto }) => {
  const key = parsePayrollConfigurationKey(input.body.config_key, input.body.unit);
  const effectiveFrom = parsePayrollDate(input.body.effective_from, "effective_from");
  const effectiveTo = input.body.effective_to == null ? null : parsePayrollDate(input.body.effective_to, "effective_to");
  assertPayrollRange(effectiveFrom, effectiveTo);
  return {
    actor: input.actor, requestId: input.requestId, shopId: parsePayrollId(input.body.shop_id, "shop_id"),
    branchId: input.body.branch_id == null ? null : parsePayrollId(input.body.branch_id, "branch_id"),
    configKey: key, numericValue: parsePayrollDecimal(input.body.numeric_value, "numeric_value"),
    unit: input.body.unit, effectiveFrom, effectiveTo,
  };
};

const parsePeriodCommand = (input: { actor: AuthenticatedActor; requestId: string; body: PayrollPeriodRequestDto }) => {
  const startDate = parsePayrollDate(input.body.start_date, "start_date");
  const endDate = parsePayrollDate(input.body.end_date, "end_date");
  if (!Number.isInteger(input.body.period_year) || input.body.period_year < 2000 || input.body.period_year > 2200 ||
      !Number.isInteger(input.body.period_month) || input.body.period_month < 1 || input.body.period_month > 12 || endDate < startDate) {
    throw new ApplicationError("VALIDATION_ERROR");
  }
  return { actor: input.actor, requestId: input.requestId, shopId: parsePayrollId(input.body.shop_id, "shop_id"),
    periodYear: input.body.period_year, periodMonth: input.body.period_month, startDate, endDate };
};

const parseAdjustmentCommand = (input: { actor: AuthenticatedActor; requestId: string; body: PayrollAdjustmentRequestDto }) => ({
  actor: input.actor, requestId: input.requestId,
  originalRecordId: parsePayrollId(input.body.original_payroll_record_id, "original_payroll_record_id"),
  targetPeriodId: parsePayrollId(input.body.applied_payroll_period_id, "applied_payroll_period_id"),
  direction: input.body.direction, amount: parsePayrollDecimal(input.body.amount, "amount", true), reason: input.body.reason.trim(),
});

export const createPayrollController = (service: PayrollControllerService) => ({
  access(input: { actor: AuthenticatedActor; requestId: string }) {
    const access = service.getPayrollAccess(input.actor);
    return { data: { can_mutate: access.canMutate, readable_branch_ids: access.readableBranchIds }, request_id: input.requestId };
  },
  async createConfiguration(input: { actor: AuthenticatedActor; requestId: string; body: PayrollConfigurationRequestDto }) {
    return { data: toPayrollConfigurationResponseDto(await service.createPayrollConfiguration(parseConfigurationCommand(input))), request_id: input.requestId };
  },
  async listConfigurations(input: { actor: AuthenticatedActor; requestId: string; shopId: string; branchId?: string; configKey?: string; onDate?: string; page?: number; pageSize?: number }) {
    if (input.configKey && !(input.configKey in payrollConfigurationUnits)) throw new ApplicationError("VALIDATION_ERROR");
    const rows = await service.listPayrollConfigurations(input.actor, parsePayrollId(input.shopId, "shop_id"), {
      branchId: input.branchId ? parsePayrollId(input.branchId, "branch_id") : undefined,
      configKey: input.configKey as PayrollConfigurationKey | undefined,
      onDate: input.onDate ? parsePayrollDate(input.onDate, "on_date") : undefined,
      page: input.page, pageSize: input.pageSize,
    }, input.requestId);
    return { data: rows.map(toPayrollConfigurationResponseDto), request_id: input.requestId };
  },
  async createPeriod(input: { actor: AuthenticatedActor; requestId: string; body: PayrollPeriodRequestDto }) {
    return { data: toPayrollPeriodResponseDto(await service.createPayrollPeriod(parsePeriodCommand(input))), request_id: input.requestId };
  },
  async listPeriods(input: { actor: AuthenticatedActor; requestId: string; shopId: string; year?: number; status?: PayrollPeriodStatus; page?: number; pageSize?: number }) {
    const rows = await service.listPayrollPeriods(input.actor, parsePayrollId(input.shopId, "shop_id"), { year: input.year, status: input.status, page: input.page, pageSize: input.pageSize }, input.requestId);
    return { data: rows.map(toPayrollPeriodResponseDto), request_id: input.requestId };
  },
  async period(input: { actor: AuthenticatedActor; requestId: string; periodId: string }) {
    const detail = await service.getPayrollPeriod(input.actor, parsePayrollId(input.periodId, "period_id"), input.requestId);
    return { data: { period: toPayrollPeriodResponseDto(detail.period), records: detail.records.map(toPayrollRecordResponseDto), blockers: detail.blockers }, request_id: input.requestId };
  },
  async record(input: { actor: AuthenticatedActor; requestId: string; periodId: string; recordId: string }) {
    const record = await service.getPayrollRecord(input.actor, parsePayrollId(input.periodId, "period_id"), parsePayrollId(input.recordId, "record_id"), input.requestId);
    return { data: toPayrollRecordResponseDto(record), request_id: input.requestId };
  },
  async preview(input: { actor: AuthenticatedActor; requestId: string; periodId: string }) {
    const result = await service.previewPayrollPeriod(input.actor, parsePayrollId(input.periodId, "period_id"), input.requestId);
    return { data: { period: toPayrollPeriodResponseDto(result.period), records: result.records.map(toPayrollRecordResponseDto), blockers: result.blockers }, request_id: input.requestId };
  },
  async lock(input: { actor: AuthenticatedActor; requestId: string; periodId: string }) {
    const result = await service.lockPayrollPeriod(input.actor, parsePayrollId(input.periodId, "period_id"), input.requestId);
    return { data: { period: toPayrollPeriodResponseDto(result.period), records: result.records.map(toPayrollRecordResponseDto), blockers: result.blockers }, request_id: input.requestId };
  },
  async requestAdjustment(input: { actor: AuthenticatedActor; requestId: string; body: PayrollAdjustmentRequestDto }) {
    return { data: toPayrollAdjustmentResponseDto(await service.requestPayrollAdjustment(parseAdjustmentCommand(input))), request_id: input.requestId };
  },
  async decideAdjustment(input: { actor: AuthenticatedActor; requestId: string; adjustmentId: string; decision: "approved" | "rejected" }) {
    const row = await service.decidePayrollAdjustment(input.actor, parsePayrollId(input.adjustmentId, "adjustment_id"), input.decision, input.requestId);
    return { data: toPayrollAdjustmentResponseDto(row), request_id: input.requestId };
  },
  async listAdjustments(input: { actor: AuthenticatedActor; requestId: string; recordId?: string; periodId?: string; status?: PayrollAdjustmentStatus; page?: number; pageSize?: number }) {
    const rows = await service.listPayrollAdjustments(input.actor, {
      recordId: input.recordId ? parsePayrollId(input.recordId, "record_id") : undefined,
      periodId: input.periodId ? parsePayrollId(input.periodId, "period_id") : undefined,
      status: input.status,
      page: input.page, pageSize: input.pageSize,
    }, input.requestId);
    return { data: rows.map(toPayrollAdjustmentResponseDto), request_id: input.requestId };
  },
});
