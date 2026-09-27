import { createActionContext } from "../../core/audit/action-context";
import { roleGrantAuditSnapshot } from "../../core/audit/audit-redaction";
import type { AuthenticatedActor, RoleCode } from "../../core/auth/auth.types";
import { canAdministerRole, canAssignGrant } from "../../core/auth/authorization";
import type { DatabaseExecutor, TransactionRunner } from "../../core/db/transaction";
import { ApplicationError } from "../../core/errors/application.error";
import type { AuditService } from "../audit/audit.service";
import type { InsertedRoleGrant, RoleRecord, RoleRepositoryPort } from "./role.repository";
export type { RoleRepositoryPort } from "./role.repository";

export interface RoleGrantResult {
  id: string;
  accountId: string;
  roleId: string;
  roleCode: RoleCode;
  scope: "self" | "department" | "branch" | "all";
  branchId: string | null;
  departmentId: string | null;
  grantedByAccountId: string;
  grantedAt: Date;
}

export interface RoleServiceDependencies {
  repository: RoleRepositoryPort;
  rootExecutor: DatabaseExecutor;
  transactionRunner: TransactionRunner;
  audit: AuditService;
}

const validId = (value: string): boolean => /^[1-9]\d*$/.test(value);

const requireAdministrator = (actor: AuthenticatedActor): void => {
  if (!canAdministerRole(actor, "EMPLOYEE")) throw new ApplicationError("FORBIDDEN_SCOPE");
};

const validateShape = (role: RoleRecord, branchId: string | null, departmentId: string | null): void => {
  const valid =
    (role.scope === "self" && branchId === null && departmentId === null) ||
    (role.scope === "department" && branchId !== null && departmentId !== null) ||
    (role.scope === "branch" && branchId !== null && departmentId === null) ||
    (role.scope === "all" && branchId === null && departmentId === null);
  if (!valid || (branchId !== null && !validId(branchId)) || (departmentId !== null && !validId(departmentId))) {
    throw new ApplicationError("INVALID_ROLE_SCOPE");
  }
};

const toResult = (row: InsertedRoleGrant, role: RoleRecord): RoleGrantResult => ({
  id: row.id,
  accountId: row.userAccountId,
  roleId: row.roleId,
  roleCode: role.code,
  scope: role.scope,
  branchId: row.branchId,
  departmentId: row.departmentId,
  grantedByAccountId: row.grantedByUserAccountId,
  grantedAt: row.grantedAt,
});

export const createRoleService = (dependencies: RoleServiceDependencies) => ({
  async listRoles(command: { actor: AuthenticatedActor; requestId: string }): Promise<RoleRecord[]> {
    const context = createActionContext({ requestId: command.requestId, actor: command.actor, actionBase: "role.catalog.read", target: { tableName: "roles", recordId: "collection" } });
    return dependencies.audit.actions.observeRead(context, async () => {
      requireAdministrator(command.actor);
      return dependencies.repository.listCatalog(dependencies.rootExecutor);
    });
  },

  async grantRole(command: {
    actor: AuthenticatedActor;
    accountId: string;
    roleCode: RoleCode;
    branchId: string | null;
    departmentId: string | null;
    reason: string;
    requestId: string;
  }): Promise<RoleGrantResult> {
    const context = createActionContext({ requestId: command.requestId, actor: command.actor, actionBase: "role.grant.create", target: { tableName: "user_account_roles", recordId: command.accountId } });
    return dependencies.audit.actions.observeMutation(context, () => dependencies.transactionRunner.transaction(async (executor) => {
      if (!validId(command.accountId)) throw new ApplicationError("VALIDATION_ERROR");
      const role = await dependencies.repository.findRoleByCode(executor, command.roleCode);
      if (!role) throw new ApplicationError("RESOURCE_NOT_FOUND");
      if (!role.isActive) throw new ApplicationError("STATE_CONFLICT");
      validateShape(role, command.branchId, command.departmentId);

      const account = await dependencies.repository.findAccount(executor, command.accountId);
      if (!account) throw new ApplicationError("RESOURCE_NOT_FOUND");
      const proposal = { roleCode: role.code, scope: role.scope, branchId: command.branchId, departmentId: command.departmentId, roleActive: true };
      if (!canAssignGrant(command.actor, proposal, account.employeeId ?? undefined)) throw new ApplicationError("FORBIDDEN_SCOPE");

      if (command.branchId !== null && !await dependencies.repository.branchExists(executor, command.branchId)) {
        throw new ApplicationError("INVALID_ORGANIZATION_RELATION");
      }
      if (command.departmentId !== null && !await dependencies.repository.departmentBelongsToBranch(executor, command.departmentId, command.branchId!)) {
        throw new ApplicationError("INVALID_ORGANIZATION_RELATION");
      }
      if (await dependencies.repository.findDuplicateGrant(executor, { accountId: command.accountId, roleId: role.id, branchId: command.branchId, departmentId: command.departmentId })) {
        throw new ApplicationError("DUPLICATE_ROLE_GRANT");
      }

      const inserted = await dependencies.repository.insertGrant(executor, {
        userAccountId: command.accountId, roleId: role.id, branchId: command.branchId,
        departmentId: command.departmentId, grantedByUserAccountId: command.actor.accountId,
      });
      const result = toResult(inserted, role);
      const receipt = await dependencies.audit.domain.record(executor, context, { newData: roleGrantAuditSnapshot({
        id: inserted.id, user_account_id: inserted.userAccountId, role_id: inserted.roleId,
        branch_id: inserted.branchId, department_id: inserted.departmentId, granted_at: inserted.grantedAt,
      }) });
      return dependencies.audit.domain.complete(result, receipt);
    }));
  },

  async revokeRole(command: { actor: AuthenticatedActor; accountId: string; grantId: string; reason: string; requestId: string }): Promise<void> {
    const context = createActionContext({ requestId: command.requestId, actor: command.actor, actionBase: "role.grant.revoke", target: { tableName: "user_account_roles", recordId: command.grantId } });
    return dependencies.audit.actions.observeMutation(context, () => dependencies.transactionRunner.transaction(async (executor) => {
      if (!validId(command.accountId) || !validId(command.grantId)) throw new ApplicationError("VALIDATION_ERROR");
      const grant = await dependencies.repository.findGrantForAccount(executor, command.accountId, command.grantId);
      if (!grant) throw new ApplicationError("RESOURCE_NOT_FOUND");
      if (!grant.roleActive) throw new ApplicationError("STATE_CONFLICT");
      const account = await dependencies.repository.findAccount(executor, command.accountId);
      if (!account) throw new ApplicationError("RESOURCE_NOT_FOUND");
      const proposal = { roleCode: grant.roleCode, scope: grant.roleScope, branchId: grant.branchId, departmentId: grant.departmentId, roleActive: true };
      if (!canAssignGrant(command.actor, proposal, account.employeeId ?? undefined)) throw new ApplicationError("FORBIDDEN_SCOPE");
      if (grant.roleCode === "OWNER" && account.status === "active" && await dependencies.repository.countActiveOwnerAccounts(executor) <= 1) {
        throw new ApplicationError("STATE_CONFLICT");
      }
      await dependencies.repository.deleteGrant(executor, command.grantId);
      const receipt = await dependencies.audit.domain.record(executor, context, { oldData: roleGrantAuditSnapshot({
        id: grant.id, user_account_id: grant.userAccountId, role_id: grant.roleId,
        branch_id: grant.branchId, department_id: grant.departmentId,
      }) });
      return dependencies.audit.domain.complete(undefined, receipt);
    }));
  },
});

export type RoleService = ReturnType<typeof createRoleService>;
