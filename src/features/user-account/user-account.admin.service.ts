import { createActionContext } from "../../core/audit/action-context";
import { accountAuditSnapshot } from "../../core/audit/audit-redaction";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { canAdministerRole } from "../../core/auth/authorization";
import { hashPassword } from "../../core/auth/password";
import type {
  DatabaseExecutor,
  TransactionRunner,
} from "../../core/db/transaction";
import { ApplicationError } from "../../core/errors/application.error";
import type { AuditService } from "../audit/audit.service";
import type {
  AccountListPage,
  AccountListQuery,
  AdminAccountRecord,
  AdminGrantRecord,
  UserAccountAdminRepository,
} from "./user-account.admin.repository";

export interface AccountDetailResult {
  account: AdminAccountRecord;
  grants: AdminGrantRecord[];
}

export interface CreatedAccountResult extends AccountDetailResult {
  temporaryPassword: string;
}

export interface UserAccountAdminServiceDependencies {
  repository: UserAccountAdminRepository;
  rootExecutor: DatabaseExecutor;
  transactionRunner: TransactionRunner;
  audit: AuditService;
  passwordHasher?: (plainText: string) => Promise<string>;
  temporaryPasswordGenerator?: () => string;
}

const requireAdministrator = (actor: AuthenticatedActor): void => {
  if (!canAdministerRole(actor, "EMPLOYEE")) {
    throw new ApplicationError("FORBIDDEN_SCOPE");
  }
};

const requireId = (value: string): void => {
  if (!/^[1-9]\d*$/.test(value)) throw new ApplicationError("VALIDATION_ERROR");
};

const snapshot = (account: AdminAccountRecord) =>
  accountAuditSnapshot({
    id: account.id,
    username: account.username,
    employee_id: account.employeeId,
    status: account.status,
    failed_login_attempts: account.failedLoginAttempts,
    locked_until: account.lockedUntil,
  });

const context = (
  actor: AuthenticatedActor,
  requestId: string,
  actionBase: string,
  recordId: string,
) =>
  createActionContext({
    actor,
    requestId,
    actionBase,
    target: { tableName: "user_accounts", recordId },
  });

const defaultTemporaryPassword = (): string => {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return `Hp!${Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("")}`;
};

export const createUserAccountAdminService = (
  dependencies: UserAccountAdminServiceDependencies,
) => {
  const passwordHasher = dependencies.passwordHasher ?? hashPassword;
  const generateTemporaryPassword =
    dependencies.temporaryPasswordGenerator ?? defaultTemporaryPassword;

  return {
    listAccounts(command: {
      actor: AuthenticatedActor;
      requestId: string;
      query: AccountListQuery;
    }): Promise<AccountListPage> {
      const observation = context(
        command.actor,
        command.requestId,
        "account.catalog.list",
        "collection",
      );
      return dependencies.audit.actions.observeRead(observation, async () => {
        requireAdministrator(command.actor);
        return dependencies.repository.list(
          dependencies.rootExecutor,
          command.query,
        );
      });
    },

    getAccount(command: {
      actor: AuthenticatedActor;
      requestId: string;
      accountId: string;
    }): Promise<AccountDetailResult> {
      const observation = context(
        command.actor,
        command.requestId,
        "account.profile.read",
        command.accountId,
      );
      return dependencies.audit.actions.observeRead(observation, async () => {
        requireAdministrator(command.actor);
        requireId(command.accountId);
        const account = await dependencies.repository.findById(
          dependencies.rootExecutor,
          command.accountId,
        );
        if (!account) throw new ApplicationError("RESOURCE_NOT_FOUND");
        const grants = await dependencies.repository.findActiveGrants(
          dependencies.rootExecutor,
          command.accountId,
        );
        return { account, grants };
      });
    },

    createAccount(command: {
      actor: AuthenticatedActor;
      requestId: string;
      username: string;
      employeeId: string | null;
    }): Promise<CreatedAccountResult> {
      const observation = context(
        command.actor,
        command.requestId,
        "account.profile.create",
        "unknown",
      );
      return dependencies.audit.actions.observeMutation(observation, () =>
        dependencies.transactionRunner.transaction(async (executor) => {
          requireAdministrator(command.actor);
          const username = command.username.trim();
          if (!/^[A-Za-z0-9._-]{3,100}$/.test(username)) {
            throw new ApplicationError("VALIDATION_ERROR");
          }
          if (command.employeeId !== null) requireId(command.employeeId);
          if (
            await dependencies.repository.findByUsername(executor, username)
          ) {
            throw new ApplicationError("DUPLICATE_USERNAME");
          }
          if (command.employeeId !== null) {
            if (
              !(await dependencies.repository.employeeExists(
                executor,
                command.employeeId,
              ))
            ) {
              throw new ApplicationError("RESOURCE_NOT_FOUND");
            }
            if (
              await dependencies.repository.findByEmployeeId(
                executor,
                command.employeeId,
              )
            ) {
              throw new ApplicationError("EMPLOYEE_ACCOUNT_ALREADY_EXISTS");
            }
          }

          const temporaryPassword = generateTemporaryPassword();
          const passwordHash = await passwordHasher(temporaryPassword);
          const account = await dependencies.repository.insert(executor, {
            username,
            employeeId: command.employeeId,
            passwordHash,
          });
          const successContext = context(
            command.actor,
            command.requestId,
            "account.profile.create",
            account.id,
          );
          const receipt = await dependencies.audit.domain.record(
            executor,
            successContext,
            {
              newData: snapshot(account),
            },
          );
          return dependencies.audit.domain.complete(
            { account, grants: [], temporaryPassword },
            receipt,
          );
        }),
      );
    },

    changeStatus(command: {
      actor: AuthenticatedActor;
      requestId: string;
      accountId: string;
      status: "active" | "disabled";
      reason: string;
    }): Promise<AccountDetailResult> {
      const observation = context(
        command.actor,
        command.requestId,
        "account.status.change",
        command.accountId,
      );
      return dependencies.audit.actions.observeMutation(observation, () =>
        dependencies.transactionRunner.transaction(async (executor) => {
          requireAdministrator(command.actor);
          requireId(command.accountId);
          const before = await dependencies.repository.findById(
            executor,
            command.accountId,
          );
          if (!before) throw new ApplicationError("RESOURCE_NOT_FOUND");
          if (before.status === command.status)
            throw new ApplicationError("STATE_CONFLICT");
          if (
            command.status === "disabled" &&
            before.status === "active" &&
            (await dependencies.repository.hasActiveOwnerGrant(
              executor,
              command.accountId,
            )) &&
            (await dependencies.repository.countActiveOwnerAccounts(
              executor,
            )) <= 1
          ) {
            throw new ApplicationError("STATE_CONFLICT");
          }
          const account = await dependencies.repository.updateStatus(
            executor,
            command.accountId,
            command.status,
          );
          if (!account) throw new ApplicationError("STATE_CONFLICT");
          const grants = await dependencies.repository.findActiveGrants(
            executor,
            command.accountId,
          );
          const receipt = await dependencies.audit.domain.record(
            executor,
            observation,
            {
              oldData: snapshot(before),
              newData: snapshot(account),
            },
          );
          return dependencies.audit.domain.complete(
            { account, grants },
            receipt,
          );
        }),
      );
    },

    resetPassword(command: {
      actor: AuthenticatedActor;
      requestId: string;
      accountId: string;
      reason: string;
    }): Promise<CreatedAccountResult> {
      const observation = context(
        command.actor,
        command.requestId,
        "account.credential.reset",
        command.accountId,
      );
      return dependencies.audit.actions.observeMutation(observation, () =>
        dependencies.transactionRunner.transaction(async (executor) => {
          requireAdministrator(command.actor);
          requireId(command.accountId);
          const before = await dependencies.repository.findById(
            executor,
            command.accountId,
          );
          if (!before) throw new ApplicationError("RESOURCE_NOT_FOUND");
          if (before.status === "disabled")
            throw new ApplicationError("STATE_CONFLICT");
          const temporaryPassword = generateTemporaryPassword();
          const account = await dependencies.repository.updatePassword(
            executor,
            command.accountId,
            await passwordHasher(temporaryPassword),
          );
          if (!account) throw new ApplicationError("STATE_CONFLICT");
          const grants = await dependencies.repository.findActiveGrants(
            executor,
            command.accountId,
          );
          const receipt = await dependencies.audit.domain.record(
            executor,
            observation,
            {
              oldData: snapshot(before),
              newData: snapshot(account),
            },
          );
          return dependencies.audit.domain.complete(
            { account, grants, temporaryPassword },
            receipt,
          );
        }),
      );
    },

    unlockAccount(command: {
      actor: AuthenticatedActor;
      requestId: string;
      accountId: string;
      reason: string;
    }): Promise<AccountDetailResult> {
      const observation = context(
        command.actor,
        command.requestId,
        "account.lock.unlock",
        command.accountId,
      );
      return dependencies.audit.actions.observeMutation(observation, () =>
        dependencies.transactionRunner.transaction(async (executor) => {
          requireAdministrator(command.actor);
          requireId(command.accountId);
          const before = await dependencies.repository.findById(
            executor,
            command.accountId,
          );
          if (!before) throw new ApplicationError("RESOURCE_NOT_FOUND");
          if (before.status !== "locked")
            throw new ApplicationError("STATE_CONFLICT");
          const account = await dependencies.repository.unlock(
            executor,
            command.accountId,
          );
          if (!account) throw new ApplicationError("STATE_CONFLICT");
          const grants = await dependencies.repository.findActiveGrants(
            executor,
            command.accountId,
          );
          const receipt = await dependencies.audit.domain.record(
            executor,
            observation,
            {
              oldData: snapshot(before),
              newData: snapshot(account),
            },
          );
          return dependencies.audit.domain.complete(
            { account, grants },
            receipt,
          );
        }),
      );
    },
  };
};

export type UserAccountAdminService = ReturnType<
  typeof createUserAccountAdminService
>;
