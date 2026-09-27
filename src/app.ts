import Elysia from "elysia";
import { authConfig } from "./core/config/auth.config";
import { createRequestAuthenticator } from "./core/auth/request-authenticator";
import { createSessionJwtCodec } from "./core/auth/session-jwt-codec";
import { createSessionTokenService } from "./core/auth/session-token";
import { ActionObserver } from "./core/audit/action-observer";
import { DomainAuditObserver } from "./core/audit/domain-audit-observer";
import { db } from "./core/db/client";
import { withTransaction, type TransactionRunner } from "./core/db/transaction";
import { success } from "./shared/http/response";
import { auditRepository } from "./features/audit/audit.repository";
import { createAuditService } from "./features/audit/audit.service";
import { createBranchService } from "./features/branch/branch.service";
import { branchRepository } from "./features/branch/branch.repository";
import { createDepartmentService } from "./features/department/department.service";
import { departmentRepository } from "./features/department/department.repository";
import { createOrganizationRoutes, type OrganizationRoutesOptions } from "./features/organization/organization.routes";
import { createPayrollRoutes, type PayrollRoutesOptions } from "./features/payroll/payroll.routes";
import { DrizzlePayrollInputProvider, DrizzlePayrollRepository } from "./features/payroll/payroll.repository";
import { createPayrollService } from "./features/payroll/payroll.service";
import { createPositionService } from "./features/position/position.service";
import { positionRepository } from "./features/position/position.repository";
import { createRoleRoutes, type RoleRoutesOptions } from "./features/role/role.routes";
import { createRoleService } from "./features/role/role.service";
import { roleRepository } from "./features/role/role.repository";
import { shopRepository } from "./features/shop/shop.repository";
import { createShopService } from "./features/shop/shop.service";
import { createUserAccountRoutes, type UserAccountRoutesOptions } from "./features/user-account/user-account.routes";
import { createUserAccountService } from "./features/user-account/user-account.service";
import { authenticatedActorLoader } from "./features/user-account/user-account.auth-adapter";
import { createUserAccountAdminRoutes, type UserAccountAdminRoutesOptions } from "./features/user-account/user-account.admin.routes";
import { createUserAccountAdminService } from "./features/user-account/user-account.admin.service";
import { userAccountAdminRepository } from "./features/user-account/user-account.admin.repository";
import {
  createTransactionalUserAccountRepository,
  userAccountRepository,
} from "./features/user-account/user-account.repository";

const transactionRunner: TransactionRunner = {
  transaction: (work) => withTransaction(work),
};

const createAuthenticator = () => createRequestAuthenticator({
  jwtSecret: authConfig.jwtSecret,
  sessionTtlSeconds: authConfig.sessionTtlSeconds,
  actorLoader: authenticatedActorLoader,
});

const concretePayrollOptions = (): PayrollRoutesOptions => ({
  service: createPayrollService({
    repository: new DrizzlePayrollRepository(),
    inputs: new DrizzlePayrollInputProvider(),
    audit: {
      async record(executor, event) {
        await auditRepository.insert(executor, {
          actorAccountId: event.actorId,
          action: `${event.action}.succeeded`,
          tableName: event.tableName,
          recordId: event.recordId,
          reason: event.reason,
          requestId: event.requestId,
        });
      },
    },
  }),
  authenticate: createAuthenticator(),
  allowedOrigins: authConfig.allowedOrigins,
});

const concreteUserAccountOptions = (): UserAccountRoutesOptions => ({
  service: createUserAccountService({
    transactionRunner,
    repository: userAccountRepository,
    repositoryFactory: createTransactionalUserAccountRepository,
    tokenService: createSessionTokenService(
      createSessionJwtCodec(authConfig.jwtSecret),
      { ttlSeconds: authConfig.sessionTtlSeconds },
    ),
    actions: new ActionObserver(db, auditRepository),
    domain: new DomainAuditObserver(auditRepository),
    maxFailedAttempts: authConfig.maxFailedAttempts,
    lockDurationSeconds: authConfig.lockDurationSeconds,
  }),
  allowedOrigins: authConfig.allowedOrigins,
  secureCookies: authConfig.secureCookies,
  sessionTtlSeconds: authConfig.sessionTtlSeconds,
});

const concreteOrganizationOptions = (): OrganizationRoutesOptions => {
  const audit = createAuditService(db, auditRepository);
  return {
    actions: audit.actions,
    services: {
      shops: createShopService({
        repository: shopRepository,
        rootExecutor: db,
        transactionRunner,
        audit,
      }),
      branches: createBranchService({
        repository: branchRepository,
        rootExecutor: db,
        transactionRunner,
        audit,
      }),
      departments: createDepartmentService({
        repository: departmentRepository,
        rootExecutor: db,
        transactionRunner,
        audit,
      }),
      positions: createPositionService({
        repository: positionRepository,
        rootExecutor: db,
        transactionRunner,
        audit,
      }),
    },
    authenticate: createAuthenticator(),
    allowedOrigins: authConfig.allowedOrigins,
  };
};

const concreteUserAccountAdminOptions = (): UserAccountAdminRoutesOptions => ({
  service: createUserAccountAdminService({
    repository: userAccountAdminRepository,
    rootExecutor: db,
    transactionRunner,
    audit: createAuditService(db, auditRepository),
  }),
  authenticate: createAuthenticator(),
  allowedOrigins: authConfig.allowedOrigins,
});

const concreteRoleOptions = (): RoleRoutesOptions => ({
  service: createRoleService({
    repository: roleRepository,
    rootExecutor: db,
    transactionRunner,
    audit: createAuditService(db, auditRepository),
  }),
  authenticate: createAuthenticator(),
  allowedOrigins: authConfig.allowedOrigins,
});

export const createApp = (
  payrollOptions: PayrollRoutesOptions = concretePayrollOptions(),
  userAccountOptions: UserAccountRoutesOptions = concreteUserAccountOptions(),
  organizationOptions: OrganizationRoutesOptions = concreteOrganizationOptions(),
  userAccountAdminOptions: UserAccountAdminRoutesOptions = concreteUserAccountAdminOptions(),
  roleOptions: RoleRoutesOptions = concreteRoleOptions(),
) =>
  new Elysia({ name: "haris-payroll" })
    .get("/", () => success({ service: "haris-payroll", status: "ok" }))
    .use(createUserAccountRoutes(userAccountOptions))
    .use(createOrganizationRoutes(organizationOptions))
    .use(createUserAccountAdminRoutes(userAccountAdminOptions))
    .use(createRoleRoutes(roleOptions))
    .use(createPayrollRoutes(payrollOptions));

// Person C owns this composition root. Feature owners export route plugins;
// registrations are added here without moving feature logic into app.ts.
export const app = createApp();
