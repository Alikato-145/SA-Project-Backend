import { accountAuditSnapshot } from "../../core/audit/audit-redaction";
import { createActionContext } from "../../core/audit/action-context";
import {
  markFailureAsAudited,
  type ActionObserver,
} from "../../core/audit/action-observer";
import type { DomainAuditObserver } from "../../core/audit/domain-audit-observer";
import { verifyPassword, verifyPasswordForUnknownAccount } from "../../core/auth/password";
import type {
  AccountStatus,
  RoleCode,
  RoleScope,
} from "../../core/auth/auth.types";
import type { SessionTokenService } from "../../core/auth/session-token";
import type {
  DatabaseTransaction,
  TransactionRunner,
} from "../../core/db/transaction";
import { ApplicationError } from "../../core/errors/application.error";
import {
  isAccountTemporarilyLocked,
  nextFailedLoginState,
  successfulLoginState,
} from "./user-account.lockout";
import {
  type ActiveGrantRecord,
  type AuthenticationAccountRecord,
  type CurrentActorAccountRecord,
  type UserAccountRepository,
} from "./user-account.repository";

export interface CurrentActorResult {
  account: {
    id: string;
    username: string;
    status: AccountStatus;
    employee: {
      id: string;
      employeeCode: string;
      displayName: string;
    } | null;
  };
  grants: readonly {
    id: string;
    roleCode: RoleCode;
    scope: RoleScope;
    branchId: string | null;
    departmentId: string | null;
  }[];
  capabilities: readonly string[];
}

type AuthenticationRepository = Pick<
  UserAccountRepository,
  | "findAuthenticationByUsernameForUpdate"
  | "findCurrentActorAccountById"
  | "findActiveGrants"
  | "updateFailedLogin"
  | "updateSuccessfulLogin"
>;

type CurrentActorRepository = Pick<
  UserAccountRepository,
  "findCurrentActorAccountById" | "findActiveGrants"
>;

export interface UserAccountAuthenticationService {
  login(command: {
    username: string;
    password: string;
    requestId: string;
  }): Promise<{ token: string; actor: CurrentActorResult }>;
  logout(command: {
    token: string | undefined;
    requestId: string;
  }): Promise<void>;
  getCurrentActor(command: {
    token: string | undefined;
    requestId: string;
  }): Promise<CurrentActorResult>;
}

export interface UserAccountServiceDependencies {
  transactionRunner: TransactionRunner;
  repository: CurrentActorRepository;
  repositoryFactory: (
    transaction: DatabaseTransaction,
  ) => AuthenticationRepository;
  tokenService: SessionTokenService;
  actions: ActionObserver;
  domain: DomainAuditObserver;
  now?: () => Date;
  maxFailedAttempts?: number;
  lockDurationSeconds?: number;
  passwordVerifier?: (plainText: string, passwordHash: string) => Promise<boolean>;
  unknownAccountPasswordVerifier?: (submittedPassword: string) => Promise<false>;
}

const roleCapabilities: Readonly<Record<RoleCode, readonly string[]>> = {
  EMPLOYEE: ["employee.read.self"],
  SUPERVISOR: ["employee.read.department"],
  BRANCH_MANAGER: ["employee.read.branch"],
  HR: ["employee.read.all", "account.manage.all", "audit.read.all"],
  OWNER: [
    "employee.read.all",
    "account.manage.all",
    "audit.read.all",
    "system.manage.all",
  ],
};

const capabilitiesFor = (grants: readonly ActiveGrantRecord[]): string[] => [
  ...new Set(grants.flatMap((grant) => roleCapabilities[grant.roleCode])),
].sort();

const displayName = (account: CurrentActorAccountRecord): string =>
  [account.employeeFirstName, account.employeeLastName]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" ");

const projectCurrentActor = async (
  accountId: number,
  repository: CurrentActorRepository,
): Promise<CurrentActorResult | null> => {
  const account = await repository.findCurrentActorAccountById(accountId);
  if (!account || account.status !== "active") return null;

  const grants = await repository.findActiveGrants(accountId);
  return {
    account: {
      id: String(account.id),
      username: account.username,
      status: account.status,
      employee:
        account.employeeId !== null && account.employeeCode !== null
          ? {
              id: String(account.employeeId),
              employeeCode: account.employeeCode,
              displayName: displayName(account),
            }
          : null,
    },
    grants: grants.map((grant) => ({
      id: String(grant.id),
      roleCode: grant.roleCode,
      scope: grant.scope,
      branchId: grant.branchId === null ? null : String(grant.branchId),
      departmentId:
        grant.departmentId === null ? null : String(grant.departmentId),
    })),
    capabilities: capabilitiesFor(grants),
  };
};

const accountSnapshot = (
  account: Pick<
    AuthenticationAccountRecord,
    "id" | "employeeId" | "status" | "failedLoginAttempts" | "lockedUntil"
  >,
) =>
  accountAuditSnapshot({
    id: String(account.id),
    employee_id:
      account.employeeId === null ? null : String(account.employeeId),
    status: account.status,
    failed_login_attempts: account.failedLoginAttempts,
    locked_until: account.lockedUntil,
  });

const loginContext = (
  requestId: string,
  recordId: string,
  actorAccountId: string | null = null,
) =>
  createActionContext({
    requestId,
    actorAccountId,
    actionBase: "authentication.session.login",
    target: { tableName: "user_accounts", recordId },
  });

type LoginOutcome =
  | { kind: "success"; token: string; actor: CurrentActorResult }
  | { kind: "failure"; error: ApplicationError };

export const createUserAccountService = (
  dependencies: UserAccountServiceDependencies,
): UserAccountAuthenticationService => {
  const now = dependencies.now ?? (() => new Date());
  const maxFailedAttempts = dependencies.maxFailedAttempts ?? 5;
  const lockDurationSeconds = dependencies.lockDurationSeconds ?? 15 * 60;
  const passwordVerifier = dependencies.passwordVerifier ?? verifyPassword;
  const unknownPasswordVerifier =
    dependencies.unknownAccountPasswordVerifier ??
    verifyPasswordForUnknownAccount;

  const service: UserAccountAuthenticationService = {
    async login(command) {
      const observationContext = loginContext(command.requestId, "unknown");
      const outcome = await dependencies.actions.observeMutation(
        observationContext,
        () =>
          dependencies.transactionRunner.transaction(async (transaction) => {
            const repository = dependencies.repositoryFactory(transaction);
            const account =
              await repository.findAuthenticationByUsernameForUpdate(
                command.username,
              );

            if (!account) {
              await unknownPasswordVerifier(command.password);
              throw new ApplicationError("INVALID_CREDENTIALS");
            }

            const accountId = String(account.id);
            const anonymousContext = loginContext(command.requestId, accountId);
            const currentTime = now();

            if (account.status === "disabled") {
              throw new ApplicationError("ACCOUNT_DISABLED");
            }
            if (isAccountTemporarilyLocked(account, currentTime)) {
              throw new ApplicationError("ACCOUNT_LOCKED", {
                retryAt: account.lockedUntil?.toISOString(),
              });
            }

            const passwordMatches = await passwordVerifier(
              command.password,
              account.passwordHash,
            );
            if (!passwordMatches) {
              const failedState = nextFailedLoginState(
                account.failedLoginAttempts,
                currentTime,
                maxFailedAttempts,
                lockDurationSeconds,
              );
              const updated = await repository.updateFailedLogin(
                account.id,
                {
                  status:
                    failedState.status === "locked" ? "locked" : "active",
                  failedLoginAttempts: failedState.failedLoginAttempts,
                  lockedUntil: failedState.lockedUntil,
                },
              );
              if (!updated) throw new ApplicationError("INTERNAL_ERROR");

              const error =
                failedState.status === "locked"
                  ? new ApplicationError("ACCOUNT_LOCKED", {
                      retryAt: failedState.lockedUntil?.toISOString(),
                    })
                  : new ApplicationError("INVALID_CREDENTIALS");
              const receipt = await dependencies.domain.record(
                transaction,
                anonymousContext,
                {
                  oldData: accountSnapshot(account),
                  newData: accountSnapshot(updated),
                  outcome: "failed",
                  reason: error.code,
                },
              );
              return dependencies.domain.complete<LoginOutcome>(
                { kind: "failure", error },
                receipt,
              );
            }

            const successfulState = successfulLoginState(currentTime);
            const updated = await repository.updateSuccessfulLogin(account.id, {
              status: "active",
              failedLoginAttempts: 0,
              lockedUntil: null,
              lastLoginAt: successfulState.lastLoginAt,
            });
            if (!updated) throw new ApplicationError("INTERNAL_ERROR");

            const actor = await projectCurrentActor(account.id, repository);
            if (!actor) throw new ApplicationError("INTERNAL_ERROR");
            const token = await dependencies.tokenService.issue(accountId);
            const successContext = loginContext(
              command.requestId,
              accountId,
              accountId,
            );
            const receipt = await dependencies.domain.record(
              transaction,
              successContext,
              {
                oldData: accountSnapshot(account),
                newData: accountSnapshot(updated),
              },
            );
            return dependencies.domain.complete<LoginOutcome>(
              { kind: "success", token, actor },
              receipt,
            );
          }),
      );

      if (outcome.kind === "failure") {
        throw markFailureAsAudited(outcome.error);
      }
      return { token: outcome.token, actor: outcome.actor };
    },

    async logout(command) {
      const claims = await dependencies.tokenService.verify(command.token);
      const context = createActionContext({
        requestId: command.requestId,
        actorAccountId: claims?.sub ?? null,
        actionBase: "authentication.session.logout",
        target: {
          tableName: "user_accounts",
          recordId: claims?.sub ?? "self",
        },
      });
      await dependencies.actions.observeRead(context, async () => undefined);
    },

    async getCurrentActor(command) {
      const claims = await dependencies.tokenService.verify(command.token);
      const context = createActionContext({
        requestId: command.requestId,
        actorAccountId: claims?.sub ?? null,
        actionBase: "authentication.session.view",
        target: {
          tableName: "user_accounts",
          recordId: claims?.sub ?? "self",
        },
      });

      return dependencies.actions.observeRead(context, async () => {
        if (!claims) throw new ApplicationError("AUTH_REQUIRED");
        const accountId = Number(claims.sub);
        if (!Number.isSafeInteger(accountId) || accountId <= 0) {
          throw new ApplicationError("AUTH_REQUIRED");
        }
        const actor = await projectCurrentActor(
          accountId,
          dependencies.repository,
        );
        if (!actor) throw new ApplicationError("AUTH_REQUIRED");
        return actor;
      });
    },
  };

  return service;
};
