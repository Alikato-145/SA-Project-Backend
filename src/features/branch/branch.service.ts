import { createActionContext } from "../../core/audit/action-context";
import { branchAuditSnapshot } from "../../core/audit/audit-redaction";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type {
  DatabaseExecutor,
  TransactionRunner,
} from "../../core/db/transaction";
import { ApplicationError } from "../../core/errors/application.error";
import type { AuditService } from "../audit/audit.service";
import {
  canAdministerOrganization,
  projectOrganizationVisibility,
} from "../organization/organization.scope";
import type {
  BranchRecord,
  OrganizationPage,
} from "../organization/organization.types";
import {
  parseDecimalBigIntId,
  parseIanaTimezone,
  parseOptionalTrimmedText,
  parseRequiredTrimmedText,
} from "../organization/organization.validation";
import type { BranchRepositoryPort } from "./branch.repository";
export type { BranchRepositoryPort } from "./branch.repository";

export interface BranchServiceDependencies {
  repository: BranchRepositoryPort;
  rootExecutor: DatabaseExecutor;
  transactionRunner: TransactionRunner;
  audit: AuditService;
}

export interface ListBranchesCommand {
  actor: AuthenticatedActor;
  requestId: string;
  page: number;
  pageSize: number;
  search: string | null;
  isActive: boolean;
  shopId: string | null;
}

export interface CreateBranchCommand {
  actor: AuthenticatedActor;
  requestId: string;
  shopId: string;
  code: unknown;
  name: unknown;
  address?: unknown;
  timezone?: unknown;
}

export interface UpdateBranchCommand {
  actor: AuthenticatedActor;
  requestId: string;
  id: string;
  code?: unknown;
  name?: unknown;
  address?: unknown;
  timezone?: unknown;
}

export interface DeactivateBranchCommand {
  actor: AuthenticatedActor;
  requestId: string;
  id: string;
  reason: unknown;
}

const requireOrganizationVisibility = (actor: AuthenticatedActor) => {
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
  if (!canAdministerOrganization(actor)) {
    throw new ApplicationError("FORBIDDEN_SCOPE");
  }
};

const snapshot = (record: BranchRecord) =>
  branchAuditSnapshot({
    id: record.id,
    shop_id: record.shopId,
    code: record.code,
    name: record.name,
    address: record.address,
    timezone: record.timezone,
    is_active: record.isActive,
  });

const normalizeCreate = (command: CreateBranchCommand) => ({
  shopId: String(parseDecimalBigIntId(command.shopId, "shop_id")),
  code: parseRequiredTrimmedText(command.code, "code", 30),
  name: parseRequiredTrimmedText(command.name, "name", 150),
  address: parseOptionalTrimmedText(command.address, "address", 500) ?? null,
  timezone: parseIanaTimezone(command.timezone, "timezone"),
});

const normalizeUpdate = (command: UpdateBranchCommand) => {
  const input: {
    code?: string;
    name?: string;
    address?: string | null;
    timezone?: string;
  } = {};
  if (command.code !== undefined) {
    input.code = parseRequiredTrimmedText(command.code, "code", 30);
  }
  if (command.name !== undefined) {
    input.name = parseRequiredTrimmedText(command.name, "name", 150);
  }
  if (command.address !== undefined) {
    input.address =
      parseOptionalTrimmedText(command.address, "address", 500) ?? null;
  }
  if (command.timezone !== undefined) {
    input.timezone = parseIanaTimezone(command.timezone, "timezone");
  }
  if (Object.keys(input).length === 0) {
    throw new ApplicationError("VALIDATION_ERROR", {
      fieldErrors: { body: ["At least one field is required."] },
    });
  }
  return input;
};

export const createBranchService = (
  dependencies: BranchServiceDependencies,
) => ({
  async listBranches(
    command: ListBranchesCommand,
  ): Promise<OrganizationPage<BranchRecord>> {
    const context = createActionContext({
      requestId: command.requestId,
      actor: command.actor,
      actionBase: "organization.branch.list",
      target: { tableName: "branches", recordId: "collection" },
    });
    return dependencies.audit.actions.observeRead(context, () => {
      const visibility = requireOrganizationVisibility(command.actor);
      return dependencies.repository.findPage(dependencies.rootExecutor, {
        page: command.page,
        pageSize: command.pageSize,
        search: command.search,
        isActive: command.isActive,
        parentId: command.shopId,
        visibility,
      });
    });
  },

  async getBranch(command: {
    actor: AuthenticatedActor;
    requestId: string;
    id: string;
  }): Promise<BranchRecord> {
    const context = createActionContext({
      requestId: command.requestId,
      actor: command.actor,
      actionBase: "organization.branch.read",
      target: { tableName: "branches", recordId: command.id },
    });
    return dependencies.audit.actions.observeRead(context, async () => {
      const visibility = requireOrganizationVisibility(command.actor);
      const record = await dependencies.repository.findVisibleById(
        dependencies.rootExecutor,
        command.id,
        visibility,
      );
      if (!record) throw new ApplicationError("RESOURCE_NOT_FOUND");
      return record;
    });
  },

  async createBranch(command: CreateBranchCommand): Promise<BranchRecord> {
    const context = createActionContext({
      requestId: command.requestId,
      actor: command.actor,
      actionBase: "organization.branch.create",
      target: { tableName: "branches", recordId: "unknown" },
    });
    return dependencies.audit.actions.observeMutation(context, async () => {
      requireAdministrator(command.actor);
      const input = normalizeCreate(command);
      return dependencies.transactionRunner.transaction(async (executor) => {
        if (!(await dependencies.repository.findActiveShop(executor, input.shopId))) {
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

  async updateBranch(command: UpdateBranchCommand): Promise<BranchRecord> {
    const id = String(parseDecimalBigIntId(command.id, "branch_id"));
    const context = createActionContext({
      requestId: command.requestId,
      actor: command.actor,
      actionBase: "organization.branch.update",
      target: { tableName: "branches", recordId: id },
    });
    return dependencies.audit.actions.observeMutation(context, async () => {
      requireAdministrator(command.actor);
      const input = normalizeUpdate(command);
      return dependencies.transactionRunner.transaction(async (executor) => {
        const before = await dependencies.repository.findById(executor, id);
        if (!before) throw new ApplicationError("RESOURCE_NOT_FOUND");
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

  async deactivateBranch(command: DeactivateBranchCommand): Promise<BranchRecord> {
    const id = String(parseDecimalBigIntId(command.id, "branch_id"));
    const context = createActionContext({
      requestId: command.requestId,
      actor: command.actor,
      actionBase: "organization.branch.deactivate",
      target: { tableName: "branches", recordId: id },
    });
    return dependencies.audit.actions.observeMutation(context, async () => {
      requireAdministrator(command.actor);
      const reason = parseRequiredTrimmedText(command.reason, "reason", 500);
      return dependencies.transactionRunner.transaction(async (executor) => {
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

export type BranchService = ReturnType<typeof createBranchService>;
