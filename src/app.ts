import Elysia from "elysia";
import { authConfig } from "./core/config/auth.config";
import { createRequestAuthenticator } from "./core/auth/request-authenticator";
import { createSessionJwtCodec } from "./core/auth/session-jwt-codec";
import { createSessionTokenService } from "./core/auth/session-token";
import { env } from "./core/config/env.config";
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
import { createA3EmployeeRoutes, type A3EmployeeRoutesOptions } from "./features/employee/employee.routes";
import { createEmployeeService } from "./features/employee/employee.service";
import { createEmployeeBankAccountService } from "./features/employee-bank-account/employee-bank-account.service";
import { bankAccountRepository } from "./features/employee-bank-account/employee-bank-account.repository";
import { bankKeyringFromEnv, createBankAccountCipher } from "./features/employee-bank-account/employee-bank-account.crypto";
import { createEmployeeWeeklyHolidayService } from "./features/employee-weekly-holiday/employee-weekly-holiday.service";
import { holidayRepository } from "./features/employee-weekly-holiday/employee-weekly-holiday.repository";
import { createEmploymentAssignmentService } from "./features/employment-assignment/employment-assignment.service";
import { employmentAssignmentRepository } from "./features/employment-assignment/employment-assignment.repository";
import { departmentRepository } from "./features/department/department.repository";
import { createOrganizationRoutes, type OrganizationRoutesOptions } from "./features/organization/organization.routes";
import { assignmentOrganizationPathRepository } from "./features/organization/organization.assignment.repository";
import { createAssignmentOrganizationValidationService } from "./features/organization/organization.validation";
import { createPayrollRoutes, type PayrollRoutesOptions } from "./features/payroll/payroll.routes";
import { createPayslipRoutes } from "./features/payslip/payslip.routes";
import { createPayslipService } from "./features/payslip/payslip.service";
import { createReportRoutes } from "./features/reports/report.routes";
import { createReportService } from "./features/reports/report.service";
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

const createConcreteUserAccountAdminService = () =>
  createUserAccountAdminService({
    repository: userAccountAdminRepository,
    rootExecutor: db,
    transactionRunner,
    audit: createAuditService(db, auditRepository),
  });

const concreteUserAccountAdminOptions = (): UserAccountAdminRoutesOptions => ({
  service: createConcreteUserAccountAdminService(),
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

const concreteEmployeeOptions = (): A3EmployeeRoutesOptions => {
  const audit = createAuditService(db, auditRepository);
  const assignmentService = createEmploymentAssignmentService({
    repository: employmentAssignmentRepository,
    rootExecutor: db,
    transactionRunner,
    organization: createAssignmentOrganizationValidationService(assignmentOrganizationPathRepository),
    actions: audit.actions,
    domain: audit.domain,
  });
  const bankAccountService = createEmployeeBankAccountService({
    repository: bankAccountRepository,
    rootExecutor: db,
    transactionRunner,
    actions: audit.actions,
    domain: audit.domain,
    cipher: createBankAccountCipher(bankKeyringFromEnv(process.env)),
  });
  const weeklyHolidayService = createEmployeeWeeklyHolidayService({
    repository: holidayRepository,
    rootExecutor: db,
    transactionRunner,
    actions: audit.actions,
    domain: audit.domain,
  });
  const accountService = createConcreteUserAccountAdminService();
  return {
    service: createEmployeeService({
      rootExecutor: db,
      transactionRunner,
      actions: audit.actions,
      domain: audit.domain,
      onboarding: {
        assignment: assignmentService,
        bank: bankAccountService,
        holiday: weeklyHolidayService,
        account: accountService,
      },
    }),
    actions: audit.actions,
    assignmentService,
    bankAccountService,
    weeklyHolidayService,
    authenticate: createAuthenticator(),
    allowedOrigins: authConfig.allowedOrigins,
  };
};

const concretePayslipService = () => {
  const audit = createAuditService(db, auditRepository);
  return createPayslipService({ rootExecutor: db, transactionRunner, actions: audit.actions, domain: audit.domain });
};

const concreteReportService = () => {
  const audit = createAuditService(db, auditRepository);
  return createReportService({ rootExecutor: db, actions: audit.actions, cipher: createBankAccountCipher(bankKeyringFromEnv(process.env)) });
};

export const createApp = (
  payrollOptions: PayrollRoutesOptions = concretePayrollOptions(),
  userAccountOptions: UserAccountRoutesOptions = concreteUserAccountOptions(),
  organizationOptions: OrganizationRoutesOptions = concreteOrganizationOptions(),
  userAccountAdminOptions: UserAccountAdminRoutesOptions = concreteUserAccountAdminOptions(),
  roleOptions: RoleRoutesOptions = concreteRoleOptions(),
  employeeOptions: A3EmployeeRoutesOptions = concreteEmployeeOptions(),
) =>
  new Elysia({ name: "haris-payroll" })
    .get("/", () => success({ service: "haris-payroll", status: "ok" }))
    .use(createUserAccountRoutes(userAccountOptions))
    .use(createOrganizationRoutes(organizationOptions))
    .use(createUserAccountAdminRoutes(userAccountAdminOptions))
    .use(createRoleRoutes(roleOptions))
    .use(createA3EmployeeRoutes(employeeOptions))
    .use(createPayrollRoutes(payrollOptions))
    .use(createPayslipRoutes({ service: concretePayslipService(), authenticate: createAuthenticator(), allowedOrigins: authConfig.allowedOrigins }))
    .use(createReportRoutes({ service: concreteReportService(), authenticate: createAuthenticator() }));

// Person C owns this composition root. Feature owners export route plugins;
// registrations are added here without moving feature logic into app.ts.
export const app = createApp();
