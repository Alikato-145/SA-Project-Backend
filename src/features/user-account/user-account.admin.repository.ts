import { and, asc, count, eq, ilike, or, sql } from "drizzle-orm";
import type { AccountStatus, RoleCode, RoleScope } from "../../core/auth/auth.types";
import type { DatabaseExecutor } from "../../core/db/transaction";
import { employees } from "../employee/employee.schema";
import { roles } from "../role/role.schema";
import { userAccountRoles, userAccounts } from "./user-account.schema";

const numericId = (value: string): number => {
  if (!/^[1-9]\d*$/.test(value)) throw new RangeError("Invalid database identifier");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new RangeError("Database identifier is outside the supported range");
  return parsed;
};

export interface AdminAccountRecord {
  id: string;
  employeeId: string | null;
  employeeCode: string | null;
  employeeFirstName: string | null;
  employeeLastName: string | null;
  username: string;
  status: AccountStatus;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminGrantRecord {
  id: string;
  roleCode: RoleCode;
  scope: RoleScope;
  branchId: string | null;
  departmentId: string | null;
}

export interface AccountListQuery {
  page: number;
  pageSize: number;
  search?: string;
  status?: AccountStatus;
  roleCode?: RoleCode;
  branchId?: string;
  departmentId?: string;
}

export interface AccountListPage {
  records: AdminAccountRecord[];
  total: number;
}

export interface UserAccountAdminRepository {
  list(executor: DatabaseExecutor, query: AccountListQuery): Promise<AccountListPage>;
  findById(executor: DatabaseExecutor, accountId: string): Promise<AdminAccountRecord | null>;
  findByUsername(executor: DatabaseExecutor, username: string): Promise<{ id: string } | null>;
  findByEmployeeId(executor: DatabaseExecutor, employeeId: string): Promise<{ id: string } | null>;
  employeeExists(executor: DatabaseExecutor, employeeId: string): Promise<boolean>;
  insert(executor: DatabaseExecutor, input: { username: string; employeeId: string | null; passwordHash: string }): Promise<AdminAccountRecord>;
  updateStatus(executor: DatabaseExecutor, accountId: string, status: "active" | "disabled"): Promise<AdminAccountRecord | null>;
  updatePassword(executor: DatabaseExecutor, accountId: string, passwordHash: string): Promise<AdminAccountRecord | null>;
  unlock(executor: DatabaseExecutor, accountId: string): Promise<AdminAccountRecord | null>;
  findActiveGrants(executor: DatabaseExecutor, accountId: string): Promise<AdminGrantRecord[]>;
  hasActiveOwnerGrant(executor: DatabaseExecutor, accountId: string): Promise<boolean>;
  countActiveOwnerAccounts(executor: DatabaseExecutor): Promise<number>;
}

const selection = {
  id: userAccounts.id,
  employeeId: userAccounts.employeeId,
  employeeCode: employees.employeeCode,
  employeeFirstName: employees.firstName,
  employeeLastName: employees.lastName,
  username: userAccounts.username,
  status: userAccounts.status,
  failedLoginAttempts: userAccounts.failedLoginAttempts,
  lockedUntil: userAccounts.lockedUntil,
  lastLoginAt: userAccounts.lastLoginAt,
  createdAt: userAccounts.createdAt,
  updatedAt: userAccounts.updatedAt,
};

const project = (row: typeof selection extends never ? never : any): AdminAccountRecord => ({
  ...row,
  id: String(row.id),
  employeeId: row.employeeId === null ? null : String(row.employeeId),
});

const accountFilter = (query: AccountListQuery) => {
  const filters = [];
  if (query.status) filters.push(eq(userAccounts.status, query.status));
  if (query.search) {
    const pattern = `%${query.search}%`;
    filters.push(or(ilike(userAccounts.username, pattern), ilike(employees.employeeCode, pattern), ilike(employees.firstName, pattern), ilike(employees.lastName, pattern))!);
  }
  if (query.roleCode) {
    filters.push(sql`exists (
      select 1 from ${userAccountRoles}
      inner join ${roles} on ${roles.id} = ${userAccountRoles.roleId}
      where ${userAccountRoles.userAccountId} = ${userAccounts.id}
        and ${roles.isActive} = true
        and ${roles.code} = ${query.roleCode}
    )`);
  }
  if (query.branchId) {
    filters.push(sql`exists (
      select 1 from ${userAccountRoles}
      where ${userAccountRoles.userAccountId} = ${userAccounts.id}
        and ${userAccountRoles.branchId} = ${numericId(query.branchId)}
    )`);
  }
  if (query.departmentId) {
    filters.push(sql`exists (
      select 1 from ${userAccountRoles}
      where ${userAccountRoles.userAccountId} = ${userAccounts.id}
        and ${userAccountRoles.departmentId} = ${numericId(query.departmentId)}
    )`);
  }
  return filters.length === 0 ? undefined : and(...filters);
};

export const userAccountAdminRepository: UserAccountAdminRepository = {
  async list(executor, query) {
    const where = accountFilter(query);
    const offset = (query.page - 1) * query.pageSize;
    const rows = await executor.select(selection).from(userAccounts)
      .leftJoin(employees, eq(employees.id, userAccounts.employeeId))
      .where(where).orderBy(asc(userAccounts.id)).limit(query.pageSize).offset(offset);
    const [totalRow] = await executor.select({ value: count() }).from(userAccounts)
      .leftJoin(employees, eq(employees.id, userAccounts.employeeId)).where(where);
    return { records: rows.map(project), total: Number(totalRow?.value ?? 0) };
  },

  async findById(executor, accountId) {
    const [row] = await executor.select(selection).from(userAccounts)
      .leftJoin(employees, eq(employees.id, userAccounts.employeeId))
      .where(eq(userAccounts.id, numericId(accountId))).limit(1);
    return row ? project(row) : null;
  },

  async findByUsername(executor, username) {
    const [row] = await executor.select({ id: userAccounts.id }).from(userAccounts)
      .where(eq(userAccounts.username, username)).limit(1);
    return row ? { id: String(row.id) } : null;
  },

  async findByEmployeeId(executor, employeeId) {
    const [row] = await executor.select({ id: userAccounts.id }).from(userAccounts)
      .where(eq(userAccounts.employeeId, numericId(employeeId))).limit(1);
    return row ? { id: String(row.id) } : null;
  },

  async employeeExists(executor, employeeId) {
    const [row] = await executor.select({ id: employees.id }).from(employees)
      .where(eq(employees.id, numericId(employeeId))).limit(1);
    return Boolean(row);
  },

  async insert(executor, input) {
    const [row] = await executor.insert(userAccounts).values({
      username: input.username,
      employeeId: input.employeeId === null ? null : numericId(input.employeeId),
      passwordHash: input.passwordHash,
    }).returning({ id: userAccounts.id });
    if (!row) throw new Error("Account insert did not return a row");
    const created = await this.findById(executor, String(row.id));
    if (!created) throw new Error("Created account could not be loaded");
    return created;
  },

  async updateStatus(executor, accountId, status) {
    const [row] = await executor.update(userAccounts).set({
      status,
      failedLoginAttempts: status === "active" ? 0 : undefined,
      lockedUntil: status === "active" ? null : undefined,
      updatedAt: new Date(),
    }).where(eq(userAccounts.id, numericId(accountId))).returning({ id: userAccounts.id });
    return row ? this.findById(executor, String(row.id)) : null;
  },

  async updatePassword(executor, accountId, passwordHash) {
    const [row] = await executor.update(userAccounts).set({
      passwordHash,
      updatedAt: new Date(),
    }).where(and(eq(userAccounts.id, numericId(accountId)), sql`${userAccounts.status} <> 'disabled'`))
      .returning({ id: userAccounts.id });
    return row ? this.findById(executor, String(row.id)) : null;
  },

  async unlock(executor, accountId) {
    const [row] = await executor.update(userAccounts).set({
      status: "active", failedLoginAttempts: 0, lockedUntil: null, updatedAt: new Date(),
    }).where(and(eq(userAccounts.id, numericId(accountId)), eq(userAccounts.status, "locked")))
      .returning({ id: userAccounts.id });
    return row ? this.findById(executor, String(row.id)) : null;
  },

  async findActiveGrants(executor, accountId) {
    const rows = await executor.select({
      id: userAccountRoles.id, roleCode: roles.code, scope: roles.scope,
      branchId: userAccountRoles.branchId, departmentId: userAccountRoles.departmentId,
    }).from(userAccountRoles).innerJoin(roles, eq(roles.id, userAccountRoles.roleId))
      .where(and(eq(userAccountRoles.userAccountId, numericId(accountId)), eq(roles.isActive, true)));
    return rows.map((row) => ({
      id: String(row.id), roleCode: row.roleCode as RoleCode, scope: row.scope as RoleScope,
      branchId: row.branchId === null ? null : String(row.branchId),
      departmentId: row.departmentId === null ? null : String(row.departmentId),
    }));
  },

  async hasActiveOwnerGrant(executor, accountId) {
    const [row] = await executor.select({ id: userAccountRoles.id }).from(userAccountRoles)
      .innerJoin(roles, eq(roles.id, userAccountRoles.roleId)).where(and(
        eq(userAccountRoles.userAccountId, numericId(accountId)), eq(roles.code, "OWNER"), eq(roles.isActive, true),
      )).limit(1);
    return Boolean(row);
  },

  async countActiveOwnerAccounts(executor) {
    const [row] = await executor.select({ value: sql<number>`count(distinct ${userAccounts.id})` })
      .from(userAccountRoles).innerJoin(userAccounts, eq(userAccounts.id, userAccountRoles.userAccountId))
      .innerJoin(roles, eq(roles.id, userAccountRoles.roleId)).where(and(
        eq(roles.code, "OWNER"), eq(roles.isActive, true), eq(userAccounts.status, "active"),
      ));
    return Number(row?.value ?? 0);
  },
};
