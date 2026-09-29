import type { DatabaseExecutor } from "../../core/db/transaction";
import { ApplicationError } from "../../core/errors/application.error";
import { assertPayrollMutationAccess, assertPayrollRecordAccess, payrollReadableBranchIds } from "./payroll.authorization";
import { calculatePayroll, payrollRecordTotalsReconcile } from "./calculation/payroll-calculator";
import { formatMoney, money } from "./calculation/decimal";
import type { DrizzlePayrollInputRepository, PayrollInputMutation, PayrollInputProvider, PayrollRepository, PayrollRepositorySession } from "./payroll.repository";
import { serializePayrollInputs } from "./payroll.input-lock.repository";
import type {
  CreatePayrollConfigurationCommand,
  CreatePayrollPeriodCommand,
  PayrollActor,
  PayrollAdjustmentRecord,
  PayrollConfigurationRecord,
  PayrollPeriodRecord,
  PayrollPeriodDetail,
  PayrollPreviewResult,
} from "./payroll.types";
import { assertPayrollRange, parsePayrollConfigurationKey, parsePayrollDecimal, parsePayrollId } from "./payroll.validation";

export interface PayrollAuditPort {
  record(executor: DatabaseExecutor, event: {
    actorId: string;
    requestId: string;
    action: string;
    tableName: string;
    recordId: string;
    reason?: string;
  }): Promise<void>;
}

export interface PayrollServiceDependencies {
  repository: PayrollRepository;
  inputs: PayrollInputProvider;
  audit: PayrollAuditPort;
}

const mappedError = (error: unknown): never => {
  if (error instanceof ApplicationError) throw error;
  const code = error instanceof Error ? error.message : "";
  if (code === "PAYROLL_PERIOD_STATE_CONFLICT") throw new ApplicationError("PAYROLL_PERIOD_STATE_CONFLICT");
  if (code === "PAYROLL_ADJUSTMENT_STATE_CONFLICT") throw new ApplicationError("PAYROLL_ADJUSTMENT_STATE_CONFLICT");
  throw error;
};

const requirePeriod = async (session: PayrollRepositorySession, periodId: string, lock = false) => {
  const period = await session.findPeriod(periodId, lock);
  if (!period) throw new ApplicationError("PAYROLL_PERIOD_NOT_FOUND");
  return period;
};

type PayrollListPage = { page?: number; pageSize?: number };
const pageRows = <T>(rows: readonly T[], page: PayrollListPage): T[] => {
  const pageNumber = page.page ?? 1;
  const pageSize = page.pageSize ?? 50;
  return rows.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
};

const auditRead = async (dependencies: PayrollServiceDependencies, actor: PayrollActor, requestId: string | undefined,
  action: string, tableName: string, recordId: string) => {
  if (!requestId) return;
  await dependencies.repository.withTransaction((session) => dependencies.audit.record(session.executor, {
    actorId: actor.accountId, requestId, action, tableName, recordId,
  }));
};

export const createPayrollService = (dependencies: PayrollServiceDependencies) => ({
  getPayrollAccess(actor: PayrollActor) {
    const readableBranchIds = payrollReadableBranchIds(actor);
    let canMutate = true;
    try { assertPayrollMutationAccess(actor); } catch { canMutate = false; }
    return { canMutate, readableBranchIds };
  },

  async createPayrollConfiguration(command: CreatePayrollConfigurationCommand): Promise<PayrollConfigurationRecord> {
    assertPayrollMutationAccess(command.actor);
    parsePayrollConfigurationKey(command.configKey, command.unit);
    assertPayrollRange(command.effectiveFrom, command.effectiveTo);
    parsePayrollDecimal(command.numericValue, "numeric_value");
    return dependencies.repository.withTransaction(async (session) => {
      if (!(await session.findActiveShop(command.shopId))) {
        throw new ApplicationError("RESOURCE_NOT_FOUND");
      }
      if (await session.findConfigurationOverlap(command)) {
        throw new ApplicationError("PAYROLL_CONFIGURATION_OVERLAP");
      }
      const created = await session.insertConfiguration({ ...command, actorId: command.actor.accountId });
      await dependencies.audit.record(session.executor, { actorId: command.actor.accountId, requestId: command.requestId,
        action: "payroll.configuration.create", tableName: "payroll_configurations", recordId: created.id });
      return created;
    });
  },

  async listPayrollConfigurations(actor: PayrollActor, shopId: string, filters: { branchId?: string; configKey?: PayrollConfigurationRecord["configKey"]; onDate?: string } & PayrollListPage = {}, requestId?: string): Promise<PayrollConfigurationRecord[]> {
    parsePayrollId(shopId, "shop_id");
    const branches = payrollReadableBranchIds(actor);
    const records = await dependencies.repository.listConfigurations(shopId);
    const result = pageRows(records.filter((row) =>
      (branches === null || row.branchId === null || (row.branchId !== null && branches.includes(row.branchId))) &&
      (filters.branchId === undefined || row.branchId === null || row.branchId === filters.branchId) &&
      (filters.configKey === undefined || row.configKey === filters.configKey) &&
      (filters.onDate === undefined || (row.effectiveFrom <= filters.onDate && (row.effectiveTo === null || row.effectiveTo >= filters.onDate)))), filters);
    await auditRead(dependencies, actor, requestId, "payroll.configuration.read", "payroll_configurations", "collection");
    return result;
  },

  async createPayrollPeriod(command: CreatePayrollPeriodCommand): Promise<PayrollPeriodRecord> {
    assertPayrollMutationAccess(command.actor);
    if (command.endDate < command.startDate || command.periodMonth < 1 || command.periodMonth > 12) {
      throw new ApplicationError("VALIDATION_ERROR");
    }
    return dependencies.repository.withTransaction(async (session) => {
      if (!(await session.findActiveShop(command.shopId))) {
        throw new ApplicationError("RESOURCE_NOT_FOUND");
      }
      if (await session.findPeriodByMonth(command.shopId, command.periodYear, command.periodMonth)) {
        throw new ApplicationError("PAYROLL_PERIOD_DUPLICATE");
      }
      const created = await session.insertPeriod({ ...command, actorId: command.actor.accountId });
      await dependencies.audit.record(session.executor, { actorId: command.actor.accountId, requestId: command.requestId,
        action: "payroll.period.create", tableName: "payroll_periods", recordId: created.id });
      return created;
    });
  },

  async listPayrollPeriods(actor: PayrollActor, shopId: string, filters: { year?: number; status?: PayrollPeriodRecord["status"] } & PayrollListPage = {}, requestId?: string): Promise<PayrollPeriodRecord[]> {
    payrollReadableBranchIds(actor);
    const result = pageRows((await dependencies.repository.listPeriods(parsePayrollId(shopId, "shop_id")))
      .filter((row) => (filters.year === undefined || row.periodYear === filters.year) && (filters.status === undefined || row.status === filters.status)), filters);
    await auditRead(dependencies, actor, requestId, "payroll.period.read", "payroll_periods", "collection");
    return result;
  },

  async getPayrollPeriod(actor: PayrollActor, periodId: string, requestId?: string): Promise<PayrollPeriodDetail> {
    const branches = payrollReadableBranchIds(actor);
    const period = await dependencies.repository.findPeriod(parsePayrollId(periodId, "period_id"));
    if (!period) throw new ApplicationError("PAYROLL_PERIOD_NOT_FOUND");
    const result = { period, records: await dependencies.repository.listPeriodRecords(period.id, branches), blockers: [] };
    await auditRead(dependencies, actor, requestId, "payroll.period.read", "payroll_periods", period.id);
    return result;
  },

  async getPayrollRecord(actor: PayrollActor, periodId: string, recordId: string, requestId?: string) {
    const record = await dependencies.repository.findRecordDetail(
      parsePayrollId(periodId, "period_id"),
      parsePayrollId(recordId, "record_id"),
    );
    if (!record) throw new ApplicationError("RESOURCE_NOT_FOUND");
    assertPayrollRecordAccess(actor, record.branchId);
    await auditRead(dependencies, actor, requestId, "payroll.record.read", "payroll_records", record.id);
    return record;
  },

  async previewPayrollPeriod(actor: PayrollActor, periodId: string, requestId: string): Promise<PayrollPreviewResult> {
    assertPayrollMutationAccess(actor);
    try {
      return await dependencies.repository.withTransaction(async (session) => {
        await serializePayrollInputs(session.executor);
        let period = await requirePeriod(session, periodId, true);
        if (period.status === "locked") throw new ApplicationError("PAYROLL_PERIOD_LOCKED");
        const loaded = await dependencies.inputs.load(session, period);
        const blockers = [...loaded.blockers];
        if (loaded.pendingApprovals) blockers.push({ code: "PAYROLL_APPROVALS_PENDING", employeeId: null, detail: "Approvals affecting the period remain pending." });
        const records = loaded.inputs.map(calculatePayroll);
        if (records.some((record) => !payrollRecordTotalsReconcile(record))) blockers.push({
          code: "PAYROLL_TOTAL_MISMATCH", employeeId: null, detail: "Calculated line items do not reconcile to record totals.",
        });
        for (const record of records) if (money(record.netPay) < 0n) blockers.push({
          code: "PAYROLL_NEGATIVE_NET_PAY", employeeId: record.employeeId, detail: "Calculated deductions exceed earnings.",
        });
        if (blockers.length === 0) {
          await session.replaceCalculatedRecords(period.id, records, actor.accountId, false);
          period = await session.setPreviewed(period.id);
          await dependencies.audit.record(session.executor, { actorId: actor.accountId, requestId,
            action: "payroll.period.preview", tableName: "payroll_periods", recordId: period.id });
        }
        return { period, records, blockers };
      });
    } catch (error) { return mappedError(error); }
  },

  async lockPayrollPeriod(actor: PayrollActor, periodId: string, requestId: string): Promise<PayrollPreviewResult> {
    assertPayrollMutationAccess(actor);
    try {
      return await dependencies.repository.withTransaction(async (session) => {
        await serializePayrollInputs(session.executor);
        let period = await requirePeriod(session, periodId, true);
        if (period.status === "locked") throw new ApplicationError("PAYROLL_PERIOD_LOCKED");
        const loaded = await dependencies.inputs.load(session, period, { lockSources: true });
        if (loaded.pendingApprovals) throw new ApplicationError("PAYROLL_APPROVALS_PENDING");
        if (loaded.blockers.length > 0) throw new ApplicationError(loaded.blockers[0].code);
        const records = loaded.inputs.map(calculatePayroll);
        if (records.some((record) => !payrollRecordTotalsReconcile(record))) throw new ApplicationError("PAYROLL_TOTAL_MISMATCH");
        if (records.some((record) => money(record.netPay) < 0n)) throw new ApplicationError("PAYROLL_NEGATIVE_NET_PAY");
        await session.replaceCalculatedRecords(period.id, records, actor.accountId, true);
        await session.settleFinanceSources(period.id);
        period = await session.setLocked(period.id, actor.accountId);
        await dependencies.audit.record(session.executor, { actorId: actor.accountId, requestId,
          action: "payroll.period.lock", tableName: "payroll_periods", recordId: period.id });
        return { period, records, blockers: [] };
      });
    } catch (error) { return mappedError(error); }
  },

  async requestPayrollAdjustment(command: { actor: PayrollActor; requestId: string; originalRecordId: string; targetPeriodId: string;
    direction: "earning" | "deduction"; amount: string; reason: string }): Promise<PayrollAdjustmentRecord> {
    assertPayrollMutationAccess(command.actor);
    parsePayrollDecimal(command.amount, "amount", true);
    if (!command.reason.trim() || command.reason.length > 1000) throw new ApplicationError("PAYROLL_ADJUSTMENT_INVALID");
    return dependencies.repository.withTransaction(async (session) => {
      const original = await session.findRecordState(command.originalRecordId);
      if (!original || original.status !== "locked") throw new ApplicationError("PAYROLL_ADJUSTMENT_INVALID");
      const target = await requirePeriod(session, command.targetPeriodId, true);
      if (target.status === "locked" || target.startDate <= original.periodEnd) throw new ApplicationError("PAYROLL_ADJUSTMENT_STATE_CONFLICT");
      const created = await session.insertAdjustment({ originalRecordId: command.originalRecordId,
        targetPeriodId: command.targetPeriodId, direction: command.direction, amount: command.amount,
        reason: command.reason.trim(), actorId: command.actor.accountId });
      await dependencies.audit.record(session.executor, { actorId: command.actor.accountId, requestId: command.requestId,
        action: "payroll.adjustment.request", tableName: "payroll_adjustments", recordId: created.id, reason: created.reason });
      return created;
    });
  },

  async decidePayrollAdjustment(actor: PayrollActor, adjustmentId: string, decision: "approved" | "rejected", requestId: string) {
    assertPayrollMutationAccess(actor);
    try {
      return await dependencies.repository.withTransaction(async (session) => {
        const current = await session.findAdjustment(adjustmentId);
        if (!current || current.status !== "pending") throw new ApplicationError("PAYROLL_ADJUSTMENT_STATE_CONFLICT");
        const decided = await session.decideAdjustment(adjustmentId, decision, actor.accountId);
        await dependencies.audit.record(session.executor, { actorId: actor.accountId, requestId,
          action: `payroll.adjustment.${decision}`, tableName: "payroll_adjustments", recordId: decided.id, reason: decided.reason });
        return decided;
      });
    } catch (error) { return mappedError(error); }
  },

  async listPayrollAdjustments(actor: PayrollActor, filters: { recordId?: string; periodId?: string; status?: PayrollAdjustmentRecord["status"] } & PayrollListPage = {}, requestId?: string) {
    if (filters.recordId) {
      const branch = await dependencies.repository.findRecordBranch(filters.recordId);
      if (!branch) throw new ApplicationError("RESOURCE_NOT_FOUND");
      assertPayrollRecordAccess(actor, branch);
    } else {
      assertPayrollMutationAccess(actor);
    }
    const result = pageRows((await dependencies.repository.listAdjustments(filters.recordId))
      .filter((row) => (filters.periodId === undefined || row.appliedPayrollPeriodId === filters.periodId) &&
        (filters.status === undefined || row.status === filters.status)), filters);
    await auditRead(dependencies, actor, requestId, "payroll.adjustment.read", "payroll_adjustments", filters.recordId ?? filters.periodId ?? "collection");
    return result;
  },
});

export type PayrollService = ReturnType<typeof createPayrollService>;


export const createPayrollInputService = (
  repository: DrizzlePayrollInputRepository,
  inputs: PayrollInputProvider,
) => ({
  serialize: serializePayrollInputs,
  getDebtSettlement(executor: DatabaseExecutor, debtId: number) {
    return repository.findDebtSettlement(executor, debtId);
  },
  async assertInputsMutable(executor: DatabaseExecutor, target: PayrollInputMutation): Promise<void> {
    assertPayrollRange(target.startDate, target.endDate);
    if (target.employeeId === undefined && target.branchId === undefined && target.shopId === undefined) {
      throw new ApplicationError("VALIDATION_ERROR");
    }
    await serializePayrollInputs(executor);
    if (await repository.findLockedInputPeriod(executor, target)) throw new ApplicationError("PAYROLL_PERIOD_LOCKED");
  },
  async projectAdvance(executor: DatabaseExecutor, command: { employeeId: number; date: string; amount: string; requestId?: number }): Promise<string> {
    parsePayrollDecimal(command.amount, "amount", true);
    assertPayrollRange(command.date, command.date);
    await serializePayrollInputs(executor);
    const period = await repository.findProjectionPeriod(executor, command.employeeId, command.date);
    if (!period) throw new ApplicationError("PAYROLL_PERIOD_NOT_FOUND");
    if (period.status === "locked") throw new ApplicationError("PAYROLL_PERIOD_LOCKED");
    const loaded = await inputs.load(repository.session(executor), period, { projectionCutoff: command.date });
    const blocker = loaded.blockers.find((row) => row.employeeId === null || row.employeeId === String(command.employeeId));
    if (blocker) throw new ApplicationError(blocker.code);
    const input = loaded.inputs.find((row) => row.employeeId === String(command.employeeId));
    if (!input) throw new ApplicationError("PAYROLL_ASSIGNMENT_MISSING");
    return formatMoney(money(calculatePayroll(input).netPay) - money(command.amount));
  },
});
export type PayrollInputService = ReturnType<typeof createPayrollInputService>;
