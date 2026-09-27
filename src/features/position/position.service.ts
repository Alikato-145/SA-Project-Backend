import { createActionContext } from "../../core/audit/action-context";
import { positionAuditSnapshot } from "../../core/audit/audit-redaction";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { DatabaseExecutor, TransactionRunner } from "../../core/db/transaction";
import { ApplicationError } from "../../core/errors/application.error";
import type { AuditService } from "../audit/audit.service";
import { projectOrganizationVisibility } from "../organization/organization.scope";
import { canAdministerOrganization } from "../organization/organization.scope";
import type {
  OrganizationPage,
  PositionRecord,
} from "../organization/organization.types";
import {
  parseDecimalBigIntId,
  parseRequiredTrimmedText,
} from "../organization/organization.validation";
import type { PositionRepositoryPort } from "./position.repository";

export type PositionPageResult = OrganizationPage<PositionRecord>;

export interface PositionServiceDependencies {
  repository: PositionRepositoryPort;
  rootExecutor: DatabaseExecutor;
  transactionRunner?: TransactionRunner;
  audit: AuditService;
}

const requireAdministrator = (actor: AuthenticatedActor): void => {
  if (!canAdministerOrganization(actor)) {
    throw new ApplicationError("FORBIDDEN_SCOPE");
  }
};

const mutationRunner = (dependencies: PositionServiceDependencies): TransactionRunner => {
  if (!dependencies.transactionRunner) {
    throw new Error("Position mutation transaction runner is not configured");
  }
  return dependencies.transactionRunner;
};

const snapshot = (record: PositionRecord) => positionAuditSnapshot({
  id: record.id,
  shop_id: record.shopId,
  code: record.code,
  name: record.name,
  is_active: record.isActive,
});

export interface ListPositionsCommand {
  actor: AuthenticatedActor;
  requestId: string;
  page: number;
  pageSize: number;
  search: string | null;
  isActive: boolean;
  shopId: string | null;
}

export const createPositionService = (
  dependencies: PositionServiceDependencies,
) => ({
  async listPositions(command: ListPositionsCommand): Promise<PositionPageResult> {
    const context = createActionContext({
      requestId: command.requestId,
      actor: command.actor,
      actionBase: "organization.position.list",
      target: { tableName: "positions", recordId: "collection" },
    });
    return dependencies.audit.actions.observeRead(context, async () => {
      const visibility = projectOrganizationVisibility(command.actor);
      if (
        !visibility.all &&
        visibility.branchIds.length === 0 &&
        visibility.departmentIds.length === 0
      ) {
        throw new ApplicationError("FORBIDDEN_SCOPE");
      }
      const visibleShopIds = await dependencies.repository.resolveVisibleShopIds(
        dependencies.rootExecutor,
        visibility,
      );
      if (visibleShopIds !== null && visibleShopIds.length === 0) {
        return {
          items: [],
          page: command.page,
          pageSize: command.pageSize,
          total: 0,
        };
      }
      return dependencies.repository.findPage(
        dependencies.rootExecutor,
        {
          page: command.page,
          pageSize: command.pageSize,
          search: command.search,
          isActive: command.isActive,
          parentId: command.shopId,
        },
        visibleShopIds,
      );
    });
  },

  async getPosition(command: {
    actor: AuthenticatedActor;
    requestId: string;
    positionId: string;
  }): Promise<PositionRecord> {
    const context = createActionContext({
      requestId: command.requestId,
      actor: command.actor,
      actionBase: "organization.position.read",
      target: { tableName: "positions", recordId: command.positionId },
    });
    return dependencies.audit.actions.observeRead(context, async () => {
      const visibility = projectOrganizationVisibility(command.actor);
      if (
        !visibility.all &&
        visibility.branchIds.length === 0 &&
        visibility.departmentIds.length === 0
      ) {
        throw new ApplicationError("FORBIDDEN_SCOPE");
      }
      const visibleShopIds = await dependencies.repository.resolveVisibleShopIds(
        dependencies.rootExecutor,
        visibility,
      );
      if (visibleShopIds !== null && visibleShopIds.length === 0) {
        throw new ApplicationError("RESOURCE_NOT_FOUND");
      }
      const record = await dependencies.repository.findVisibleById(
        dependencies.rootExecutor,
        command.positionId,
        visibleShopIds,
      );
      if (!record) throw new ApplicationError("RESOURCE_NOT_FOUND");
      return record;
    });
  },

  async createPosition(command: {
    actor: AuthenticatedActor;
    requestId: string;
    shopId: string;
    code: unknown;
    name: unknown;
  }): Promise<PositionRecord> {
    const context = createActionContext({
      requestId: command.requestId,
      actor: command.actor,
      actionBase: "organization.position.create",
      target: { tableName: "positions", recordId: "unknown" },
    });
    return dependencies.audit.actions.observeMutation(context, async () => {
      requireAdministrator(command.actor);
      const input = {
        shopId: String(parseDecimalBigIntId(command.shopId, "shop_id")),
        code: parseRequiredTrimmedText(command.code, "code", 30),
        name: parseRequiredTrimmedText(command.name, "name", 100),
      };
      return mutationRunner(dependencies).transaction(async (executor) => {
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

  async updatePosition(command: {
    actor: AuthenticatedActor;
    requestId: string;
    id: string;
    code?: unknown;
    name?: unknown;
  }): Promise<PositionRecord> {
    const id = String(parseDecimalBigIntId(command.id, "position_id"));
    const context = createActionContext({
      requestId: command.requestId,
      actor: command.actor,
      actionBase: "organization.position.update",
      target: { tableName: "positions", recordId: id },
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
      if (Object.keys(input).length === 0) {
        throw new ApplicationError("VALIDATION_ERROR", {
          fieldErrors: { body: ["At least one field is required."] },
        });
      }
      return mutationRunner(dependencies).transaction(async (executor) => {
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

  async deactivatePosition(command: {
    actor: AuthenticatedActor;
    requestId: string;
    id: string;
    reason: unknown;
  }): Promise<PositionRecord> {
    const id = String(parseDecimalBigIntId(command.id, "position_id"));
    const context = createActionContext({
      requestId: command.requestId,
      actor: command.actor,
      actionBase: "organization.position.deactivate",
      target: { tableName: "positions", recordId: id },
    });
    return dependencies.audit.actions.observeMutation(context, async () => {
      requireAdministrator(command.actor);
      const reason = parseRequiredTrimmedText(command.reason, "reason", 500);
      return mutationRunner(dependencies).transaction(async (executor) => {
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

export type PositionService = ReturnType<typeof createPositionService>;
