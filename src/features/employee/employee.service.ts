import { createActionContext } from "../../core/audit/action-context";
import type { ActionObserver } from "../../core/audit/action-observer";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { DatabaseExecutor } from "../../core/db/transaction";
import { ApplicationError } from "../../core/errors/application.error";
import type { EmployeeListFilters } from "./employee.dto";
import { employeeRepository, type EmployeeReadRecord, type EmployeeRepositoryPort } from "./employee.repository";
import { projectEmployeeVisibility } from "./employee.scope";
import { parseEmployeeId } from "./employee.validation";

export type EmployeeViewKind = "team" | "own" | "hr";
export interface VisibleEmployee { record: EmployeeReadRecord; view: EmployeeViewKind }
export interface EmployeePage {
  items: VisibleEmployee[];
  page: number;
  pageSize: number;
  total: number;
}
export interface EmployeeServiceDependencies {
  rootExecutor: DatabaseExecutor;
  repository?: EmployeeRepositoryPort;
  actions: ActionObserver;
  today?: () => string;
}

const currentBangkokDate = (): string => new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const viewFor = (actor: AuthenticatedActor, record: EmployeeReadRecord): EmployeeViewKind => {
  const visibility = projectEmployeeVisibility(actor);
  if (visibility.all) return "hr";
  return visibility.selfEmployeeId === record.id ? "own" : "team";
};
const hasVisibility = (actor: AuthenticatedActor): boolean => {
  const scope = projectEmployeeVisibility(actor);
  return scope.all || scope.selfEmployeeId !== null || scope.branchIds.length > 0 || scope.departments.length > 0;
};

export const createEmployeeService = (dependencies: EmployeeServiceDependencies) => {
  const repository = dependencies.repository ?? employeeRepository;
  const today = dependencies.today ?? currentBangkokDate;
  return {
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
  };
};
export type EmployeeService = ReturnType<typeof createEmployeeService>;
