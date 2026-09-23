import { createActionContext } from "../../core/audit/action-context";
import { shopAuditSnapshot } from "../../core/audit/audit-redaction";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { DatabaseExecutor, TransactionRunner } from "../../core/db/transaction";
import { ApplicationError } from "../../core/errors/application.error";
import type { AuditService } from "../audit/audit.service";
import { canAdministerOrganization, projectOrganizationVisibility } from "../organization/organization.scope";
import type { OrganizationPage, OrganizationPageInput, ShopRecord } from "../organization/organization.types";
import { parseDecimalBigIntId, parseRequiredTrimmedText } from "../organization/organization.validation";
import type { ShopRepositoryPort } from "./shop.repository";

export interface ShopServiceDependencies {
  repository: ShopRepositoryPort;
  rootExecutor: DatabaseExecutor;
  transactionRunner?: TransactionRunner;
  audit: AuditService;
}

const requireVisibility = (actor: AuthenticatedActor) => {
  const visibility = projectOrganizationVisibility(actor);
  if (!visibility.all && visibility.branchIds.length === 0 && visibility.departmentIds.length === 0) {
    throw new ApplicationError("FORBIDDEN_SCOPE");
  }
  return visibility;
};

const requireAdministrator = (actor: AuthenticatedActor): void => {
  if (!canAdministerOrganization(actor)) throw new ApplicationError("FORBIDDEN_SCOPE");
};

const transactionRunner = (dependencies: ShopServiceDependencies): TransactionRunner => {
  if (!dependencies.transactionRunner) {
    throw new Error("Shop mutation transaction runner is not configured");
  }
  return dependencies.transactionRunner;
};

const shopSnapshot = (record: ShopRecord) => shopAuditSnapshot({
  id: record.id,
  code: record.code,
  name: record.name,
  is_active: record.isActive,
});

export const createShopService = (dependencies: ShopServiceDependencies) => ({
  async listShops(command: OrganizationPageInput & {
    actor: AuthenticatedActor;
    requestId: string;
  }): Promise<OrganizationPage<ShopRecord>> {
    const context = createActionContext({
      requestId: command.requestId,
      actor: command.actor,
      actionBase: "organization.shop.list",
      target: { tableName: "shops", recordId: "collection" },
    });
    return dependencies.audit.actions.observeRead(context, async () => {
      const visibility = requireVisibility(command.actor);
      return dependencies.repository.list(dependencies.rootExecutor, {
        page: command.page,
        pageSize: command.pageSize,
        search: command.search,
        isActive: command.isActive,
      }, visibility);
    });
  },

  async getShop(command: {
    actor: AuthenticatedActor;
    requestId: string;
    shopId: string;
  }): Promise<ShopRecord> {
    const context = createActionContext({
      requestId: command.requestId,
      actor: command.actor,
      actionBase: "organization.shop.read",
      target: { tableName: "shops", recordId: command.shopId },
    });
    return dependencies.audit.actions.observeRead(context, async () => {
      const visibility = requireVisibility(command.actor);
      const record = await dependencies.repository.findById(
        dependencies.rootExecutor,
        command.shopId,
        visibility,
      );
      if (!record) throw new ApplicationError("RESOURCE_NOT_FOUND");
      return record;
    });
  },

  async createShop(command: {
    actor: AuthenticatedActor;
    requestId: string;
    code: string;
    name: string;
  }): Promise<ShopRecord> {
    const context = createActionContext({
      requestId: command.requestId,
      actor: command.actor,
      actionBase: "organization.shop.create",
      target: { tableName: "shops", recordId: "unknown" },
    });
    return dependencies.audit.actions.observeMutation(context, () =>
      transactionRunner(dependencies).transaction(async (executor) => {
        requireAdministrator(command.actor);
        const created = await dependencies.repository.insert(executor, {
          code: parseRequiredTrimmedText(command.code, "code", 30),
          name: parseRequiredTrimmedText(command.name, "name", 150),
        });
        const receipt = await dependencies.audit.domain.record(executor, context, {
          newData: shopSnapshot(created),
        });
        return dependencies.audit.domain.complete(created, receipt);
      }),
    );
  },

  async updateShop(command: {
    actor: AuthenticatedActor;
    requestId: string;
    shopId: string;
    code?: string;
    name?: string;
  }): Promise<ShopRecord> {
    const context = createActionContext({
      requestId: command.requestId,
      actor: command.actor,
      actionBase: "organization.shop.update",
      target: { tableName: "shops", recordId: command.shopId },
    });
    return dependencies.audit.actions.observeMutation(context, () =>
      transactionRunner(dependencies).transaction(async (executor) => {
        requireAdministrator(command.actor);
        const current = await dependencies.repository.findById(
          executor,
          command.shopId,
          { all: true, branchIds: [], departmentIds: [] },
        );
        if (!current) throw new ApplicationError("RESOURCE_NOT_FOUND");

        const update: { code?: string; name?: string } = {};
        if (command.code !== undefined) {
          update.code = parseRequiredTrimmedText(command.code, "code", 30);
        }
        if (command.name !== undefined) {
          update.name = parseRequiredTrimmedText(command.name, "name", 150);
        }
        if (Object.keys(update).length === 0) {
          throw new ApplicationError("VALIDATION_ERROR");
        }

        const updated = await dependencies.repository.update(executor, command.shopId, update);
        if (!updated) throw new ApplicationError("RESOURCE_NOT_FOUND");
        const receipt = await dependencies.audit.domain.record(executor, context, {
          oldData: shopSnapshot(current),
          newData: shopSnapshot(updated),
        });
        return dependencies.audit.domain.complete(updated, receipt);
      }),
    );
  },

  async deactivateShop(command: {
    actor: AuthenticatedActor;
    requestId: string;
    shopId: string;
    reason: unknown;
  }): Promise<ShopRecord> {
    const id = String(parseDecimalBigIntId(command.shopId, "shop_id"));
    const context = createActionContext({
      requestId: command.requestId,
      actor: command.actor,
      actionBase: "organization.shop.deactivate",
      target: { tableName: "shops", recordId: id },
    });
    return dependencies.audit.actions.observeMutation(context, () =>
      transactionRunner(dependencies).transaction(async (executor) => {
        requireAdministrator(command.actor);
        const reason = parseRequiredTrimmedText(command.reason, "reason", 500);
        const current = await dependencies.repository.findById(
          executor,
          id,
          { all: true, branchIds: [], departmentIds: [] },
        );
        if (!current) throw new ApplicationError("RESOURCE_NOT_FOUND");
        if (!current.isActive) throw new ApplicationError("STATE_CONFLICT");

        const deactivated = await dependencies.repository.deactivate(executor, id);
        if (!deactivated) throw new ApplicationError("STATE_CONFLICT");
        const receipt = await dependencies.audit.domain.record(executor, context, {
          oldData: shopSnapshot(current),
          newData: shopSnapshot(deactivated),
          reason,
        });
        return dependencies.audit.domain.complete(deactivated, receipt);
      }),
    );
  },
});

export type ShopService = ReturnType<typeof createShopService>;
