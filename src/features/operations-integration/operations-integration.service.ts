import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { canAccessTarget, parseActiveGrant } from "../../core/auth/authorization";
import { ApplicationError } from "../../core/errors/application.error";

export type OperationAssignment = { branchId: number; departmentId: number };

export interface OperationsScopeRepository {
  assignmentAt(employeeId: number, date: string): Promise<OperationAssignment | undefined>;
  branchShopId(branchId: number): Promise<number | undefined>;
  payrollLocked(employeeId: number, date: string): Promise<boolean>;
  workedDays(employeeId: number, startDate: string, endDate: string): Promise<number>;
  baseSalary(employeeId: number, date: string): Promise<string | undefined>;
  projectedNetPay(employeeId: number, monthStart: string, advanceAmount: string): Promise<string>;
  overtimeEligible(employeeId: number, date: string, type: "hourly" | "rest_day" | "public_holiday", workDayRecordId?: number | null): Promise<boolean>;
}

const numericId = (value: string | null): number => {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new ApplicationError("AUTH_REQUIRED");
  return id;
};

const businessScope = (actor: AuthenticatedActor, assignment: OperationAssignment) => {
  if (actor.grants.some((grant) => parseActiveGrant(grant)?.scope === "all")) return "all" as const;
  if (actor.grants.some((grant) => parseActiveGrant(grant)?.scope === "branch" && Number(parseActiveGrant(grant)?.branchId) === assignment.branchId)) return "branch" as const;
  if (actor.grants.some((grant) => {
    const parsed = parseActiveGrant(grant);
    return parsed?.scope === "department" && Number(parsed.branchId) === assignment.branchId && Number(parsed.departmentId) === assignment.departmentId;
  })) return "department" as const;
  return "self" as const;
};

const highestScope = (actor: AuthenticatedActor) => {
  if (actor.grants.some((grant) => parseActiveGrant(grant)?.scope === "all")) return "all" as const;
  if (actor.grants.some((grant) => parseActiveGrant(grant)?.scope === "branch")) return "branch" as const;
  if (actor.grants.some((grant) => parseActiveGrant(grant)?.scope === "department")) return "department" as const;
  return "self" as const;
};

export class OperationsIntegrationService {
  constructor(private readonly repository: OperationsScopeRepository) {}

  account(actor: AuthenticatedActor) {
    return { accountId: numericId(actor.accountId) };
  }

  featureActor(actor: AuthenticatedActor) {
    return { ...this.account(actor), scope: highestScope(actor), authenticated: actor };
  }

  authenticated(actor: unknown): AuthenticatedActor {
    const candidate = actor as Partial<AuthenticatedActor>;
    if (typeof candidate.accountId === "string" && typeof candidate.username === "string" &&
      (candidate.employeeId === null || typeof candidate.employeeId === "string") && Array.isArray(candidate.grants)) {
      return candidate as AuthenticatedActor;
    }
    throw new ApplicationError("AUTH_REQUIRED");
  }

  async scopedActor(actor: AuthenticatedActor, employeeId: number, date: string) {
    const assignment = await this.assignment(employeeId, date);
    this.assertEmployee(actor, employeeId, assignment);
    return { ...this.account(actor), scope: businessScope(actor, assignment) };
  }

  async assertEmployee(actor: AuthenticatedActor, employeeId: number, assignment?: OperationAssignment, date?: string) {
    if (actor.grants.some((grant) => parseActiveGrant(grant)?.scope === "all")) return;
    if (actor.employeeId === String(employeeId)) {
      if (!canAccessTarget(actor, { scope: "self", employeeId: String(employeeId) })) {
        throw new ApplicationError("FORBIDDEN_SCOPE");
      }
      return;
    }
    const resolved = assignment ?? await this.assignment(employeeId, date ?? new Date().toISOString().slice(0, 10));
    const target = { scope: "department" as const, branchId: String(resolved.branchId), departmentId: String(resolved.departmentId) };
    if (!canAccessTarget(actor, target)) throw new ApplicationError("FORBIDDEN_SCOPE");
  }

  assertFinanceAdmin(actor: AuthenticatedActor) {
    if (!actor.grants.some((grant) => {
      const parsed = parseActiveGrant(grant);
      return parsed?.scope === "all" && (parsed.roleCode === "HR" || parsed.roleCode === "OWNER");
    })) throw new ApplicationError("FORBIDDEN_SCOPE");
  }

  async assertManageBranch(actor: AuthenticatedActor, branchId: number) {
    if (!canAccessTarget(actor, { scope: "branch", branchId: String(branchId) })) {
      throw new ApplicationError("FORBIDDEN_SCOPE");
    }
  }

  async assertManageShop(actor: AuthenticatedActor, shopId: number) {
    if (!actor.grants.some((grant) => parseActiveGrant(grant)?.scope === "all")) {
      throw new ApplicationError("FORBIDDEN_SCOPE");
    }
    if (!Number.isSafeInteger(shopId) || shopId < 1) throw new ApplicationError("VALIDATION_ERROR");
  }

  async assertDateUnlocked(_transaction: unknown, employeeId: number, date: string) {
    if (await this.repository.payrollLocked(employeeId, date)) throw new ApplicationError("PAYROLL_PERIOD_LOCKED");
  }

  async assertDatesUnlocked(transaction: unknown, employeeId: number, dates: string[]) {
    for (const date of dates) await this.assertDateUnlocked(transaction, employeeId, date);
  }

  async branchAtDate(employeeId: number, date: string) {
    return (await this.assignment(employeeId, date)).branchId;
  }

  async getWorkedDays(_actor: { accountId: number }, employeeId: number, monthStart: string, requestDate: string) {
    return this.repository.workedDays(employeeId, monthStart, requestDate);
  }

  async getBaseSalary(employeeId: number, date: string) {
    return (await this.repository.baseSalary(employeeId, date)) ?? (() => { throw new ApplicationError("PAYROLL_ASSIGNMENT_MISSING"); })();
  }

  async netPayAfterAdvance(employeeId: number, monthStart: string, amount: string) {
    return this.repository.projectedNetPay(employeeId, monthStart, amount);
  }

  async assertOvertimeEligible(command: { employeeId: number; overtimeDate: string; overtimeType: "hourly" | "rest_day" | "public_holiday"; workDayRecordId?: number | null }) {
    if (!await this.repository.overtimeEligible(command.employeeId, command.overtimeDate, command.overtimeType, command.workDayRecordId)) {
      throw new ApplicationError("VALIDATION_ERROR");
    }
  }

  private async assignment(employeeId: number, date: string) {
    const assignment = await this.repository.assignmentAt(employeeId, date);
    if (!assignment) throw new ApplicationError("RESOURCE_NOT_FOUND");
    return assignment;
  }
}
