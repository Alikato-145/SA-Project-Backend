import { createActionContext } from "../../core/audit/action-context";
import { departmentAuditSnapshot } from "../../core/audit/audit-redaction";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { DatabaseExecutor, TransactionRunner } from "../../core/db/transaction";
import { ApplicationError } from "../../core/errors/application.error";
import type { AuditService } from "../audit/audit.service";
import {
  canAdministerOrganization,
  projectOrganizationVisibility,
} from "../organization/organization.scope";
import type {
  DepartmentRecord,
  OrganizationPage,
  OrganizationVisibility,
} from "../organization/organization.types";
import {
  parseDecimalBigIntId,
  parseRequiredTrimmedText,
} from "../organization/organization.validation";
import type { DepartmentRepositoryPort } from "./department.repository";
export type { DepartmentRepositoryPort } from "./department.repository";

export interface DepartmentServiceDependencies {
  repository: DepartmentRepositoryPort;
  rootExecutor: DatabaseExecutor;
  transactionRunner?: TransactionRunner;
  audit: AuditService;
}

export interface ListDepartmentsCommand {
  actor: AuthenticatedActor;
  requestId: string;
  page: number;
  pageSize: number;
  search: string | null;
  isActive: boolean;
  branchId: string | null;
}

const requireOrganizationVisibility = (
  actor: AuthenticatedActor,
): OrganizationVisibility => {
  const visibility = projectOrganizationVisibility(actor);
  if (
    !visibility.all &&
    visibility.branchIds.length === 0 &&
    visibility.departmentIds.length === 0
  ) {
    throw new ApplicationError("FORBIDDEN_SCOPE");
  }
  return visibility;
};

const requireAdministrator = (actor: AuthenticatedActor): void => {
  if (!canAdministerOrganization(actor)) throw new ApplicationError("FORBIDDEN_SCOPE");
};

const requireTransactionRunner = (
  dependencies: DepartmentServiceDependencies,
): TransactionRunner => {
  if (!dependencies.transactionRunner) {
    throw new Error("Department mutation transaction runner is not configured");
  }
  return dependencies.transactionRunner;
};

const snapshot = (record: DepartmentRecord) => departmentAuditSnapshot({
  id: record.id,
  branch_id: record.branchId,
  code: record.code,
  name: record.name,
  is_active: record.isActive,
});

export const createDepartmentService = (
  dependencies: DepartmentServiceDependencies,
) => ({
  async listDepartments(
    command: ListDepartmentsCommand,
  ): Promise<OrganizationPage<DepartmentRecord>> {
    const context = createActionContext({
      requestId: command.requestId,
      actor: command.actor,
      actionBase: "organization.department.list",
      target: { tableName: "departments", recordId: "collection" },
    });

    return dependencies.audit.actions.observeRead(context, () => {
      const visibility = requireOrganizationVisibility(command.actor);
      return dependencies.repository.findVisiblePage(
        dependencies.rootExecutor,
        {
          page: command.page,
          pageSize: command.pageSize,
          search: command.search,
          isActive: command.isActive,
          parentId: command.branchId,
        },
        visibility,
      );
    });
  },

  async getDepartment(command: {
    actor: AuthenticatedActor;
    requestId: string;
    departmentId: string;
  }): Promise<DepartmentRecord> {
    const context = createActionContext({
      requestId: command.requestId,
      actor: command.actor,
      actionBase: "organization.department.read",
      target: { tableName: "departments", recordId: command.departmentId },
    });

    return dependencies.audit.actions.observeRead(context, async () => {
      const visibility = requireOrganizationVisibility(command.actor);
      const department = await dependencies.repository.findVisibleById(
        dependencies.rootExecutor,
        command.departmentId,
        visibility,
      );
      if (department === null) throw new ApplicationError("RESOURCE_NOT_FOUND");
      return department;
    });
  },

  async createDepartment(command: {
    actor: AuthenticatedActor;
    requestId: string;
    branchId: string;
    code: unknown;
    name: unknown;
  }): Promise<DepartmentRecord> {
    const context = createActionContext({
      requestId: command.requestId,
      actor: command.actor,
      actionBase: "organization.department.create",
      target: { tableName: "departments", recordId: "unknown" },
    });
    return dependencies.audit.actions.observeMutation(context, async () => {
      requireAdministrator(command.actor);
      const input = {
        branchId: String(parseDecimalBigIntId(command.branchId, "branch_id")),
        code: parseRequiredTrimmedText(command.code, "code", 30),
        name: parseRequiredTrimmedText(command.name, "name", 100),
      };
      return requireTransactionRunner(dependencies).transaction(async (executor) => {
        if (!(await dependencies.repository.findActiveParentChain(executor, input.branchId))) {
          throw new ApplicationError("STATE_CONFLICT");
        }
        const record = await dependencies.repository.insert(executor, input);
        const receipt = await dependencies.audit.domain.record(executor, context, {
          newData: snapshot(record),
        });
        return dependencies.audit.domain.complete(record, receipt);
      });
    });
  },

  async updateDepartment(command: {
    actor: AuthenticatedActor;
    requestId: string;
    id: string;
    code?: unknown;
    name?: unknown;
  }): Promise<DepartmentRecord> {
    const id = String(parseDecimalBigIntId(command.id, "department_id"));
    const context = createActionContext({
      requestId: command.requestId,
      actor: command.actor,
      actionBase: "organization.department.update",
      target: { tableName: "departments", recordId: id },
    });
    return dependencies.audit.actions.observeMutation(context, async () => {
      requireAdministrator(command.actor);
      const input: { code?: string; name?: string } = {};
      if (command.code !== undefined) {
        input.code = parseRequiredTrimmedText(command.code, "code", 30);
      }
      if (command.name !== undefined) {
        input.name = parseRequiredTrimmedText(command.name, "name", 100);
      }
      if (Object.keys(input).length === 0) throw new ApplicationError("VALIDATION_ERROR");

      return requireTransactionRunner(dependencies).transaction(async (executor) => {
        const before = await dependencies.repository.findById(executor, id);
        if (!before) throw new ApplicationError("RESOURCE_NOT_FOUND");
        if (!(await dependencies.repository.findActiveParentChain(executor, before.branchId))) {
          throw new ApplicationError("STATE_CONFLICT");
        }
        const record = await dependencies.repository.update(executor, id, input);
        if (!record) throw new ApplicationError("STATE_CONFLICT");
        const receipt = await dependencies.audit.domain.record(executor, context, {
          oldData: snapshot(before),
          newData: snapshot(record),
        });
        return dependencies.audit.domain.complete(record, receipt);
      });
    });
  },

  async deactivateDepartment(command: {
    actor: AuthenticatedActor;
    requestId: string;
    id: string;
    reason: unknown;
  }): Promise<DepartmentRecord> {
    const id = String(parseDecimalBigIntId(command.id, "department_id"));
    const context = createActionContext({
      requestId: command.requestId,
      actor: command.actor,
      actionBase: "organization.department.deactivate",
      target: { tableName: "departments", recordId: id },
    });
    return dependencies.audit.actions.observeMutation(context, async () => {
      requireAdministrator(command.actor);
      const reason = parseRequiredTrimmedText(command.reason, "reason", 500);
      return requireTransactionRunner(dependencies).transaction(async (executor) => {
        const before = await dependencies.repository.findById(executor, id);
        if (!before) throw new ApplicationError("RESOURCE_NOT_FOUND");
        if (!before.isActive) throw new ApplicationError("STATE_CONFLICT");
        const record = await dependencies.repository.deactivate(executor, id);
        if (!record) throw new ApplicationError("STATE_CONFLICT");
        const receipt = await dependencies.audit.domain.record(executor, context, {
          oldData: snapshot(before),
          newData: snapshot(record),
          reason,
        });
        return dependencies.audit.domain.complete(record, receipt);
      });
    });
  },
});

export type DepartmentService = ReturnType<typeof createDepartmentService>;
