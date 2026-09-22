import { and, eq } from "drizzle-orm";
import type { AccountStatus, RoleCode, RoleScope } from "../../core/auth/auth.types";
import { db } from "../../core/db/client";
import type {
  DatabaseExecutor,
  DatabaseTransaction,
} from "../../core/db/transaction";
import { roles } from "../role/role.schema";
import { employees } from "../employee/employee.schema";
import { userAccountRoles, userAccounts } from "./user-account.schema";

const roleCodes = new Set<RoleCode>([
  "EMPLOYEE",
  "SUPERVISOR",
  "BRANCH_MANAGER",
  "HR",
  "OWNER",
]);

const isRoleCode = (value: string): value is RoleCode =>
  roleCodes.has(value as RoleCode);

export interface AuthenticationAccountRecord {
  id: number;
  employeeId: number | null;
  username: string;
  passwordHash: string;
  status: AccountStatus;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
}

export interface SafeAccountRecord {
  id: number;
  employeeId: number | null;
  username: string;
  status: AccountStatus;
  lockedUntil: Date | null;
}

export interface CurrentActorAccountRecord extends SafeAccountRecord {
  employeeCode: string | null;
  employeeFirstName: string | null;
  employeeLastName: string | null;
}

export interface ActiveGrantRecord {
  id: number;
  roleCode: RoleCode;
  scope: RoleScope;
  branchId: number | null;
  departmentId: number | null;
}

export interface FailedLoginUpdate {
  status: Extract<AccountStatus, "active" | "locked">;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
}

export interface SuccessfulLoginUpdate {
  status: "active";
  failedLoginAttempts: 0;
  lockedUntil: null;
  lastLoginAt: Date;
}

const authenticationSelection = {
  id: userAccounts.id,
  employeeId: userAccounts.employeeId,
  username: userAccounts.username,
  passwordHash: userAccounts.passwordHash,
  status: userAccounts.status,
  failedLoginAttempts: userAccounts.failedLoginAttempts,
  lockedUntil: userAccounts.lockedUntil,
  lastLoginAt: userAccounts.lastLoginAt,
};

const safeAccountSelection = {
  id: userAccounts.id,
  employeeId: userAccounts.employeeId,
  username: userAccounts.username,
  status: userAccounts.status,
  lockedUntil: userAccounts.lockedUntil,
};

const currentActorAccountSelection = {
  ...safeAccountSelection,
  employeeCode: employees.employeeCode,
  employeeFirstName: employees.firstName,
  employeeLastName: employees.lastName,
};

/** Persistence operations only; authentication policy remains in the service layer. */
export class UserAccountRepository {
  constructor(private readonly executor: DatabaseExecutor = db) {}

  async findAuthenticationByUsername(
    username: string,
  ): Promise<AuthenticationAccountRecord | null> {
    const [account] = await this.executor
      .select(authenticationSelection)
      .from(userAccounts)
      .where(eq(userAccounts.username, username))
      .limit(1);

    return account ?? null;
  }

  /** Must be called with the transaction executor used for the login operation. */
  async findAuthenticationByUsernameForUpdate(
    username: string,
  ): Promise<AuthenticationAccountRecord | null> {
    const [account] = await this.executor
      .select(authenticationSelection)
      .from(userAccounts)
      .where(eq(userAccounts.username, username))
      .limit(1)
      .for("update");

    return account ?? null;
  }

  async findSafeById(accountId: number): Promise<SafeAccountRecord | null> {
    const [account] = await this.executor
      .select(safeAccountSelection)
      .from(userAccounts)
      .where(eq(userAccounts.id, accountId))
      .limit(1);

    return account ?? null;
  }

  async findCurrentActorAccountById(
    accountId: number,
  ): Promise<CurrentActorAccountRecord | null> {
    const [account] = await this.executor
      .select(currentActorAccountSelection)
      .from(userAccounts)
      .leftJoin(employees, eq(employees.id, userAccounts.employeeId))
      .where(eq(userAccounts.id, accountId))
      .limit(1);

    return account ?? null;
  }

  async findActiveGrants(accountId: number): Promise<ActiveGrantRecord[]> {
    const grants = await this.executor
      .select({
        id: userAccountRoles.id,
        roleCode: roles.code,
        scope: roles.scope,
        branchId: userAccountRoles.branchId,
        departmentId: userAccountRoles.departmentId,
      })
      .from(userAccountRoles)
      .innerJoin(roles, eq(roles.id, userAccountRoles.roleId))
      .where(
        and(
          eq(userAccountRoles.userAccountId, accountId),
          eq(roles.isActive, true),
        ),
      );

    // Unknown catalog rows never become authorization grants even if introduced
    // outside the controlled five-role bootstrap.
    return grants.filter(
      (grant): grant is ActiveGrantRecord => isRoleCode(grant.roleCode),
    );
  }

  async updateFailedLogin(
    accountId: number,
    update: FailedLoginUpdate,
  ): Promise<AuthenticationAccountRecord | null> {
    const [account] = await this.executor
      .update(userAccounts)
      .set({
        status: update.status,
        failedLoginAttempts: update.failedLoginAttempts,
        lockedUntil: update.lockedUntil,
        updatedAt: new Date(),
      })
      .where(eq(userAccounts.id, accountId))
      .returning(authenticationSelection);

    return account ?? null;
  }

  async updateSuccessfulLogin(
    accountId: number,
    update: SuccessfulLoginUpdate,
  ): Promise<AuthenticationAccountRecord | null> {
    const [account] = await this.executor
      .update(userAccounts)
      .set({
        status: update.status,
        failedLoginAttempts: update.failedLoginAttempts,
        lockedUntil: update.lockedUntil,
        lastLoginAt: update.lastLoginAt,
        updatedAt: update.lastLoginAt,
      })
      .where(eq(userAccounts.id, accountId))
      .returning(authenticationSelection);

    return account ?? null;
  }
}

export const createTransactionalUserAccountRepository = (
  transaction: DatabaseTransaction,
): UserAccountRepository => new UserAccountRepository(transaction);

export const userAccountRepository = new UserAccountRepository();
