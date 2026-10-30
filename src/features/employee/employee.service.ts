import { normalizePromptpayPhone, type EmployeePaymentDestination } from "./employee.payment-destination";
import { employeePaymentRepository, type EmployeePaymentRepositoryPort } from "./employee.repository";
import type { PayrollInputService } from "../payroll/payroll.service";
import type { EmploymentAssignmentService } from "../employment-assignment/employment-assignment.service";
import { createActionContext } from "../../core/audit/action-context";
import type { ActionObserver } from "../../core/audit/action-observer";
import type { DomainAuditObserver } from "../../core/audit/domain-audit-observer";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { parseActiveGrant } from "../../core/auth/authorization";
import type { DatabaseExecutor, TransactionRunner } from "../../core/db/transaction";
import { ApplicationError } from "../../core/errors/application.error";
import type { EmployeeCreateCommand, EmployeeListFilters, EmployeeStatus, EmployeeUpdateCommand } from "./employee.dto";
import type { AssignmentCommand } from "../employment-assignment/employment-assignment.dto";
import type { OnboardingAccountCreationPort, OnboardingAssignmentPort, OnboardingBankPort, OnboardingHolidayPort, OnboardingRolePort } from "./employee.ports";
import { employeeRepository, type EmployeeReadRecord, type EmployeeRepositoryPort, type EmployeeWriteRepositoryPort } from "./employee.repository";
import { canAdministerEmployees, canManageEmployeeBranch, projectEmployeeVisibility } from "./employee.scope";
import { employeeAuditSnapshot } from "./employee.types";
import { parseBusinessDate, parseEmployeeId } from "./employee.validation";

export type EmployeeViewKind = "team" | "own" | "hr" | "manager";
export interface VisibleEmployee { record: EmployeeReadRecord; view: EmployeeViewKind }
export interface EmployeePage {
  items: VisibleEmployee[];
  page: number;
  pageSize: number;
  total: number;
}
export interface EmployeeServiceDependencies {
  payroll: Pick<PayrollInputService, "serialize">;
  rootExecutor: DatabaseExecutor;
  repository?: EmployeeRepositoryPort;
  paymentRepository?: EmployeePaymentRepositoryPort;
  writeRepository?: EmployeeWriteRepositoryPort;
  transactionRunner?: TransactionRunner;
  actions: ActionObserver;
  domain?: DomainAuditObserver;
  today?: () => string;
  employmentTermination?:Pick<EmploymentAssignmentService,"endAssignmentsForTermination">;
  onboarding?: { assignment: OnboardingAssignmentPort; bank: OnboardingBankPort; holiday: OnboardingHolidayPort; account: OnboardingAccountCreationPort; role: OnboardingRolePort };
}

const currentBangkokDate = (): string => new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const viewFor = (actor: AuthenticatedActor, record: EmployeeReadRecord): EmployeeViewKind => {
  const visibility = projectEmployeeVisibility(actor);
  if (visibility.all) return "hr";
  if (canManageEmployeeBranch(actor, record.currentAssignment?.branchId ?? null)) return "manager";
  return visibility.selfEmployeeId === record.id ? "own" : "team";
};
const requireWrites = (dependencies: EmployeeServiceDependencies) => {
  if (!dependencies.transactionRunner || !dependencies.domain) throw new Error("Employee mutation dependencies are not configured");
  return { runner: dependencies.transactionRunner, domain: dependencies.domain, repository: dependencies.writeRepository ?? employeeRepository };
};
const requireAdministrator = (actor: AuthenticatedActor) => { if (!canAdministerEmployees(actor)) throw new ApplicationError("FORBIDDEN_SCOPE"); };
const fullVisibility = { all: true, selfEmployeeId: null, branchIds: [], departments: [] } as const;
const snapshot = (record: EmployeeReadRecord) => employeeAuditSnapshot({ id: record.id, employee_code: record.employeeCode, status: record.status, hire_date: record.hireDate, terminated_at: record.terminatedAt });
const validateCreate = (input: EmployeeCreateCommand) => {
  if ((input.employeeCode !== undefined && (!input.employeeCode.trim() || input.employeeCode.length > 30)) || !input.firstName.trim() || input.firstName.length > 100 || !input.lastName.trim() || input.lastName.length > 100 || (!input.nationalId && !input.passportId)) throw new ApplicationError("VALIDATION_ERROR");
  parseBusinessDate(input.hireDate, "hire_date");
};
const hasVisibility = (actor: AuthenticatedActor): boolean => {
  const scope = projectEmployeeVisibility(actor);
  return scope.all || scope.selfEmployeeId !== null || scope.branchIds.length > 0 || scope.departments.length > 0;
};

export const createEmployeeService = (dependencies: EmployeeServiceDependencies) => {
  const repository = dependencies.repository ?? employeeRepository;
  const today = dependencies.today ?? currentBangkokDate;
  const paymentRepository = dependencies.paymentRepository ?? employeePaymentRepository;
  return {
    async getPaymentDestinationInTransaction(executor: DatabaseExecutor, command: { actor: AuthenticatedActor; requestId: string; employeeId: string }): Promise<EmployeePaymentDestination> {
      requireAdministrator(command.actor);
      const destination = await paymentRepository.findPaymentDestination(executor, String(parseEmployeeId(command.employeeId, "employee_id")), true);
      if (!destination) throw new ApplicationError("RESOURCE_NOT_FOUND");
      return destination;
    },
    async getPaymentDestination(command: { actor: AuthenticatedActor; requestId: string; employeeId: string }): Promise<EmployeePaymentDestination> {
      const id = String(parseEmployeeId(command.employeeId, "employee_id"));
      const context = createActionContext({ requestId: command.requestId, actor: command.actor, actionBase: "employee.payment_destination.read", target: { tableName: "employees", recordId: id } });
      return dependencies.actions.observeRead(context, async () => {
        if (!canAdministerEmployees(command.actor) && !(command.actor.employeeId === id && command.actor.grants.some(grant => parseActiveGrant(grant) !== null))) throw new ApplicationError("FORBIDDEN_SCOPE");
        const destination = await paymentRepository.findPaymentDestination(dependencies.rootExecutor, id);
        if (!destination) throw new ApplicationError("RESOURCE_NOT_FOUND");
        return destination;
      });
    },
    async updatePaymentDestination(command: EmployeePaymentDestination & { actor: AuthenticatedActor; requestId: string; employeeId: string }): Promise<EmployeePaymentDestination> {
      const id = String(parseEmployeeId(command.employeeId, "employee_id"));
      const context = createActionContext({ requestId: command.requestId, actor: command.actor, actionBase: "employee.payment_destination.update", target: { tableName: "employees", recordId: id } });
      return dependencies.actions.observeMutation(context, () => {
        if (!canAdministerEmployees(command.actor) && !(command.actor.employeeId === id && command.actor.grants.some(grant => parseActiveGrant(grant) !== null))) throw new ApplicationError("FORBIDDEN_SCOPE");
        if (!["cash", "transfer"].includes(command.paymentMethod)) throw new ApplicationError("VALIDATION_ERROR");
        if (command.paymentCategory && (command.paymentCategory === "cash" ? command.paymentMethod !== "cash" : command.paymentMethod !== "transfer")) throw new ApplicationError("VALIDATION_ERROR");
        const input = { paymentMethod: command.paymentMethod, promptpayPhone: normalizePromptpayPhone(command.promptpayPhone), ...(command.paymentCategory !== undefined ? { paymentCategory: command.paymentCategory } : {}) };
        const writes = requireWrites(dependencies);
        return writes.runner.transaction(async executor => {
          const current = await paymentRepository.findPaymentDestination(executor, id, true);
          if (!current) throw new ApplicationError("RESOURCE_NOT_FOUND");
          const resolved = command.paymentCategory === undefined && current.paymentCategory && current.paymentMethod !== input.paymentMethod
            ? { ...input, paymentCategory: input.paymentMethod }
            : input;
          const updated = await paymentRepository.updatePaymentDestination(executor, id, resolved);
          if (!updated) throw new ApplicationError("RESOURCE_NOT_FOUND");
          const safe = (value: EmployeePaymentDestination) => ({ payment_method: value.paymentMethod, payment_category: value.paymentCategory ?? null, has_promptpay_phone: value.promptpayPhone !== null });
          const receipt = await writes.domain.record(executor, context, { oldData: safe(current), newData: safe(updated) });
          return writes.domain.complete(updated, receipt);
        });
      });
    },
    async listEmployees(command: EmployeeListFilters & { actor: AuthenticatedActor; requestId: string }): Promise<EmployeePage> {
      const context = createActionContext({
        requestId: command.requestId, actor: command.actor, actionBase: "employee.profile.list",
        target: { tableName: "employees", recordId: "collection" },
      });
      return dependencies.actions.observeRead(context, async () => {
        if (!hasVisibility(command.actor)) throw new ApplicationError("FORBIDDEN_SCOPE");
        const page = await repository.list(dependencies.rootExecutor, command, projectEmployeeVisibility(command.actor), today());
        return { ...page, items: page.items.map((record) => ({ record, view: viewFor(command.actor, record) })) };
      });
    },
    async getEmployee(command: { actor: AuthenticatedActor; requestId: string; employeeId: string }): Promise<VisibleEmployee> {
      const id = String(parseEmployeeId(command.employeeId, "employee_id"));
      const context = createActionContext({
        requestId: command.requestId, actor: command.actor, actionBase: "employee.profile.read",
        target: { tableName: "employees", recordId: id },
      });
      return dependencies.actions.observeRead(context, async () => {
        if (!hasVisibility(command.actor)) throw new ApplicationError("FORBIDDEN_SCOPE");
        const record = await repository.findById(dependencies.rootExecutor, id, projectEmployeeVisibility(command.actor), today());
        if (!record) throw new ApplicationError("RESOURCE_NOT_FOUND");
        return { record, view: viewFor(command.actor, record) };
      });
    },
    async createEmployee(command: EmployeeCreateCommand & { actor: AuthenticatedActor; requestId: string }): Promise<VisibleEmployee> {
      const base = createActionContext({ requestId: command.requestId, actor: command.actor, actionBase: "employee.profile.create", target: { tableName: "employees", recordId: "unknown" } });
      return dependencies.actions.observeMutation(base, () => {
        const writes = requireWrites(dependencies);
        return writes.runner.transaction(async (executor) => {
          requireAdministrator(command.actor); validateCreate(command);
          if (await writes.repository.findIdentityConflict(executor, command)) throw new ApplicationError("DUPLICATE_IDENTITY");
          const created = await writes.repository.insert(executor, command);
          const success = createActionContext({ requestId: command.requestId, actor: command.actor, actionBase: "employee.profile.create", target: { tableName: "employees", recordId: created.id } });
          const receipt = await writes.domain.record(executor, success, { newData: snapshot(created) });
          return writes.domain.complete({ record: created, view: "hr" as const }, receipt);
        });
      });
    },
    async updateEmployee(command: EmployeeUpdateCommand & { actor: AuthenticatedActor; requestId: string; employeeId: string }): Promise<VisibleEmployee> {
      const id = String(parseEmployeeId(command.employeeId, "employee_id"));
      const context = createActionContext({ requestId: command.requestId, actor: command.actor, actionBase: "employee.profile.update", target: { tableName: "employees", recordId: id } });
      return dependencies.actions.observeMutation(context, () => {
        const writes = requireWrites(dependencies);
        return writes.runner.transaction(async (executor) => {
          await dependencies.payroll.serialize(executor);
          const current = await writes.repository.findById(executor, id, fullVisibility, today());
          if (!current) throw new ApplicationError("RESOURCE_NOT_FOUND");
          if (!canManageEmployeeBranch(command.actor, current.currentAssignment?.branchId ?? null)) throw new ApplicationError("FORBIDDEN_SCOPE");
          const update: EmployeeUpdateCommand = { ...command };
          delete (update as Record<string, unknown>).actor; delete (update as Record<string, unknown>).requestId; delete (update as Record<string, unknown>).employeeId;
          if (Object.keys(update).length === 0) throw new ApplicationError("VALIDATION_ERROR");
          const nationalId = update.nationalId === undefined ? current.nationalId : update.nationalId;
          const passportId = update.passportId === undefined ? current.passportId : update.passportId;
          if (!nationalId && !passportId) throw new ApplicationError("VALIDATION_ERROR");
          if (await writes.repository.findIdentityConflict(executor, { nationalId, passportId }, id)) throw new ApplicationError("DUPLICATE_IDENTITY");
          const updated = await writes.repository.updateIdentity(executor, id, update);
          if (!updated) throw new ApplicationError("RESOURCE_NOT_FOUND");
          const receipt = await writes.domain.record(executor, context, { oldData: snapshot(current), newData: snapshot(updated) });
          return writes.domain.complete({ record: updated, view: viewFor(command.actor, current) }, receipt);
        });
      });
    },
    async onboardEmployee(command: { actor: AuthenticatedActor; requestId: string; employee: EmployeeCreateCommand; assignment: AssignmentCommand; bankAccount?: { bankCode: string; bankName: string; accountHolderName: string; accountNumber: string; isPrimary: boolean | undefined }; weeklyHolidays: { weekday: number; effectiveFrom: string; effectiveTo: string | null }[]; account?: { username: string; roleCode?: import("../../core/auth/auth.types").RoleCode } }) {
      const context = createActionContext({ requestId: command.requestId, actor: command.actor, actionBase: "employee.profile.onboard", target: { tableName: "employees", recordId: "unknown" } });
      return dependencies.actions.observeMutation(context, () => {
        const writes = requireWrites(dependencies);
        if (!dependencies.onboarding) throw new Error("Employee onboarding dependencies are not configured");
        return writes.runner.transaction(async (executor) => {
          if (!canManageEmployeeBranch(command.actor, command.assignment.branchId) || (!canAdministerEmployees(command.actor) && (command.account !== undefined || command.bankAccount !== undefined))) throw new ApplicationError("FORBIDDEN_SCOPE");
          validateCreate(command.employee);
          if (await writes.repository.findIdentityConflict(executor, command.employee)) throw new ApplicationError("DUPLICATE_IDENTITY");
          const employee = await writes.repository.insert(executor, command.employee);
          const assignment = await dependencies.onboarding!.assignment.createAssignmentInTransaction(executor, { actor: command.actor, employeeId: employee.id, ...command.assignment });
          const bank = command.bankAccount ? await dependencies.onboarding!.bank.addBankAccountInTransaction(executor, { employeeId: employee.id, ...command.bankAccount }) : null;
          const holidays = []; for (const holiday of command.weeklyHolidays) holidays.push(await dependencies.onboarding!.holiday.addHolidayInTransaction(executor, { employeeId: employee.id, ...holiday }));
          const account = command.account ? await dependencies.onboarding!.account.createAccountInTransaction(executor, { actor: command.actor, username: command.account.username, employeeId: employee.id }) : null;
          if (account) {
            const roleCode = command.account?.roleCode ?? "EMPLOYEE";
            await dependencies.onboarding!.role.grantRoleInTransaction(executor, {
              actor: command.actor, accountId: account.account.id, roleCode,
              branchId: roleCode === "BRANCH_MANAGER" || roleCode === "SUPERVISOR" ? command.assignment.branchId : null,
              departmentId: roleCode === "SUPERVISOR" ? command.assignment.departmentId : null,
              reason: "Initial role during employee onboarding", requestId: command.requestId,
            });
          }
          const success = createActionContext({ requestId: command.requestId, actor: command.actor, actionBase: "employee.profile.onboard", target: { tableName: "employees", recordId: employee.id } });
          const receipt = await writes.domain.record(executor, success, { newData: { ...snapshot(employee), assignment_id: assignment.id, bank_account_id: bank?.id ?? null, holiday_ids: holidays.map(item => item.id), account_id: account?.account.id ?? null } });
          return writes.domain.complete({ employee: { record: employee, view: canAdministerEmployees(command.actor) ? "hr" as const : "manager" as const }, assignmentId: assignment.id, bankAccountId: bank?.id ?? null, holidayIds: holidays.map(item => item.id), accountId: account?.account.id ?? null, temporaryPassword: account?.temporaryPassword ?? null }, receipt);
        });
      });
    },
    async changeEmployeeStatus(command: { actor: AuthenticatedActor; requestId: string; employeeId: string; status: EmployeeStatus; terminatedAt: string | null; reason: string }): Promise<VisibleEmployee> {
      const id = String(parseEmployeeId(command.employeeId, "employee_id"));
      const context = createActionContext({ requestId: command.requestId, actor: command.actor, actionBase: "employee.status.change", target: { tableName: "employees", recordId: id } });
      return dependencies.actions.observeMutation(context, () => {
        const writes = requireWrites(dependencies);
        return writes.runner.transaction(async (executor) => {
          await dependencies.payroll.serialize(executor);
          const current = await writes.repository.findById(executor, id, fullVisibility, today());
          if (!current) throw new ApplicationError("RESOURCE_NOT_FOUND");
          if (!canManageEmployeeBranch(command.actor, current.currentAssignment?.branchId ?? null)) throw new ApplicationError("FORBIDDEN_SCOPE");
          const reason = command.reason.trim(); if (!reason || reason.length > 500) throw new ApplicationError("VALIDATION_ERROR");
          if (command.status === "terminated") { if (!command.terminatedAt) throw new ApplicationError("VALIDATION_ERROR"); parseBusinessDate(command.terminatedAt, "terminated_at"); if (command.terminatedAt < current.hireDate) throw new ApplicationError("VALIDATION_ERROR"); }
          else if (command.terminatedAt !== null) throw new ApplicationError("VALIDATION_ERROR");
          if(current.terminatedAt!==null&&command.status==="terminated"&&current.terminatedAt!==command.terminatedAt)throw new ApplicationError("STATE_CONFLICT",{publicMessage:"วันที่สิ้นสุดการจ้างถูกบันทึกเป็นประวัติแล้ว ไม่เปลี่ยนทับผ่านการเปลี่ยนสถานะทั่วไป"});
          if(command.status==="terminated") {
            if(!dependencies.employmentTermination)throw new Error("Employee termination dependencies are not configured");
            await dependencies.employmentTermination.endAssignmentsForTermination(executor,{actor:command.actor,requestId:command.requestId,employeeId:id,date:command.terminatedAt!,reason});
          }
          const updated = await writes.repository.updateStatus(executor, id, command.status, command.status === "terminated" ? command.terminatedAt : null);
          if (!updated) throw new ApplicationError("RESOURCE_NOT_FOUND");
          const receipt = await writes.domain.record(executor, context, { oldData: snapshot(current), newData: snapshot(updated), reason });
          return writes.domain.complete({ record: updated, view: viewFor(command.actor, current) }, receipt);
        });
      });
    },
  };
};
export type EmployeeService = ReturnType<typeof createEmployeeService>;
