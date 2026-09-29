import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { PayrollInputLoadResult, PayrollInputProvider, PayrollRepository, PayrollRepositorySession } from "./payroll.repository";
import type { PayrollAdjustmentRecord, PayrollCalculationInput, PayrollConfigurationRecord, PayrollPeriodRecord } from "./payroll.types";

export const payrollActor = (roleCode: "HR" | "OWNER" | "BRANCH_MANAGER" = "HR", branchId: string | null = null): AuthenticatedActor => ({
  accountId: "1", employeeId: null, username: roleCode.toLowerCase(),
  grants: [{ grantId: "1", roleCode, scope: roleCode === "BRANCH_MANAGER" ? "branch" : "all",
    branchId: roleCode === "BRANCH_MANAGER" ? branchId ?? "2" : null, departmentId: null }],
});

export const periodFixture = (status: PayrollPeriodRecord["status"] = "draft"): PayrollPeriodRecord => ({
  id: "20", shopId: "1", periodYear: 2026, periodMonth: 9, startDate: "2026-09-01", endDate: "2026-09-30",
  status, createdByUserAccountId: "1", previewedAt: null, lockedByUserAccountId: null, lockedAt: null,
});

export const calculationFixture = (): PayrollCalculationInput => ({
  employeeId: "10", employeeCode: "EMP010", assignmentId: "30", branchId: "2",
  baseSalary: "20000.00", welfare: "1000.00", standardWorkDays: "20.00", absenceRate: "1.0000",
  lateRate: "2.0000", socialSecurityRate: "0.0500", socialSecurityCap: "750.00",
  workDays: [{ id: "40", date: "2026-09-01", status: "present", lateMinutes: 0, deductible: false }],
  overtime: [], deductions: [], adjustments: [],
});

export const createPayrollHarness = (options: {
  period?: PayrollPeriodRecord;
  input?: PayrollCalculationInput;
  load?: Partial<PayrollInputLoadResult>;
  shopExists?: boolean;
  overlap?: boolean;
  duplicatePeriod?: boolean;
  originalStatus?: "draft" | "calculated" | "locked";
  originalPeriodEnd?: string;
} = {}) => {
  let period = options.period ?? periodFixture();
  let adjustmentStatus: PayrollAdjustmentRecord["status"] = "pending";
  const calls = { replace: 0, settle: 0, audit: [] as string[] };
  const configuration: PayrollConfigurationRecord = { id: "5", shopId: "1", branchId: null,
    configKey: "STANDARD_WORK_DAYS", numericValue: "20.0000", unit: "days", effectiveFrom: "2026-01-01",
    effectiveTo: null, createdByUserAccountId: "1" };
  const adjustment = (): PayrollAdjustmentRecord => ({ id: "60", originalPayrollRecordId: "70", appliedPayrollPeriodId: "20",
    direction: "earning", amount: "100.00", reason: "Correction", status: adjustmentStatus,
    requestedByUserAccountId: "1", requestedAt: new Date("2026-09-30T00:00:00Z"),
    approvedByUserAccountId: adjustmentStatus === "pending" ? null : "1", approvedAt: adjustmentStatus === "pending" ? null : new Date(),
    appliedPayrollItemId: null });
  const session = {
    executor: { execute: async () => undefined } as unknown as PayrollRepositorySession["executor"],
    findActiveShop: async () => options.shopExists ?? true,
    findConfigurationOverlap: async () => options.overlap ?? false,
    insertConfiguration: async () => configuration,
    resolveConfiguration: async () => configuration,
    findPeriodByMonth: async () => options.duplicatePeriod ? period : null,
    insertPeriod: async () => period,
    findPeriod: async () => period,
    setPreviewed: async () => (period = { ...period, status: "previewed", previewedAt: new Date() }),
    setLocked: async (_id: string, actorId: string) => (period = { ...period, status: "locked", lockedByUserAccountId: actorId, lockedAt: new Date() }),
    replaceCalculatedRecords: async () => { calls.replace += 1; },
    settleFinanceSources: async () => { calls.settle += 1; },
    insertAdjustment: async () => adjustment(),
    findAdjustment: async () => adjustment(),
    decideAdjustment: async (_id: string, decision: "approved" | "rejected") => { adjustmentStatus = decision; return adjustment(); },
    findRecordState: async () => ({ status: options.originalStatus ?? "locked", branchId: "2", periodEnd: options.originalPeriodEnd ?? "2026-08-31" }),
  } as PayrollRepositorySession;
  const repository: PayrollRepository = {
    withTransaction: async (work) => work(session),
    listConfigurations: async () => [configuration],
    listPeriods: async () => [period],
    findPeriod: async () => period,
    findRecordBranch: async () => "2",
    findRecordDetail: async () => ({ id: "70", periodId: period.id, status: "locked", employeeId: "10", assignmentId: "30", branchId: "2",
      baseSalarySnapshot: "20000.00", welfareSnapshot: "1000.00", totalEarnings: "21000.00", totalDeductions: "0.00", netPay: "21000.00", items: [] }),
    listPeriodRecords: async () => [],
    listAdjustments: async () => [adjustment()],
  };
  const inputs: PayrollInputProvider = {
    load: async () => ({ inputs: [options.input ?? calculationFixture()], blockers: options.load?.blockers ?? [], pendingApprovals: options.load?.pendingApprovals ?? false }),
  };
  return { repository, inputs, calls, audit: { record: async (_executor: unknown, event: { action: string }) => { calls.audit.push(event.action); } } };
};
