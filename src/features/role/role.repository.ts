import { and, eq, sql } from "drizzle-orm";
import type { AccountStatus, RoleCode, RoleScope } from "../../core/auth/auth.types";
import type { DatabaseExecutor } from "../../core/db/transaction";
import { branches } from "../branch/branch.schema";
import { departments } from "../department/department.schema";
import { userAccountRoles, userAccounts } from "../user-account/user-account.schema";
import { roles } from "./role.schema";

export interface RoleRecord {
  id: string;
  code: RoleCode;
  name: string;
  scope: RoleScope;
  isActive: boolean;
}

export interface RoleAccountRecord {
  id: string;
  employeeId: string | null;
  status: AccountStatus;
}

export interface RoleGrantRecord {
  id: string;
  userAccountId: string;
  roleId: string;
  roleCode: RoleCode;
  roleScope: RoleScope;
  roleActive: boolean;
  branchId: string | null;
  departmentId: string | null;
}

export interface InsertedRoleGrant {
  id: string;
  userAccountId: string;
  roleId: string;
  branchId: string | null;
  departmentId: string | null;
  grantedByUserAccountId: string;
  grantedAt: Date;
}

export interface RoleRepositoryPort {
  listCatalog(executor: DatabaseExecutor): Promise<RoleRecord[]>;
  findRoleByCode(executor: DatabaseExecutor, code: RoleCode): Promise<RoleRecord | null>;
  findAccount(executor: DatabaseExecutor, accountId: string): Promise<RoleAccountRecord | null>;
  branchExists(executor: DatabaseExecutor, branchId: string): Promise<boolean>;
  departmentBelongsToBranch(executor: DatabaseExecutor, departmentId: string, branchId: string): Promise<boolean>;
  findDuplicateGrant(executor: DatabaseExecutor, input: { accountId: string; roleId: string; branchId: string | null; departmentId: string | null }): Promise<{ id: string } | null>;
  insertGrant(executor: DatabaseExecutor, input: { userAccountId: string; roleId: string; branchId: string | null; departmentId: string | null; grantedByUserAccountId: string }): Promise<InsertedRoleGrant>;
  findGrantForAccount(executor: DatabaseExecutor, accountId: string, grantId: string): Promise<RoleGrantRecord | null>;
  countActiveOwnerAccounts(executor: DatabaseExecutor): Promise<number>;
  deleteGrant(executor: DatabaseExecutor, grantId: string): Promise<void>;
}

const numericId = (value: string): number => {
  if (!/^[1-9]\d*$/.test(value)) throw new RangeError("Invalid database identifier");
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new RangeError("Database identifier is outside the supported range");
  return result;
};

const idString = (value: number): string => String(value);

export const roleRepository: RoleRepositoryPort = {
  async listCatalog(executor) {
    const rows = await executor.select().from(roles).orderBy(roles.id);
    return rows.map((row) => ({ ...row, id: idString(row.id), code: row.code as RoleCode, scope: row.scope as RoleScope }));
  },

  async findRoleByCode(executor, code) {
    const [row] = await executor.select().from(roles).where(eq(roles.code, code)).limit(1);
    return row ? { ...row, id: idString(row.id), code: row.code as RoleCode, scope: row.scope as RoleScope } : null;
  },

  async findAccount(executor, accountId) {
    const [row] = await executor.select({ id: userAccounts.id, employeeId: userAccounts.employeeId, status: userAccounts.status })
      .from(userAccounts).where(eq(userAccounts.id, numericId(accountId))).limit(1);
    return row ? { id: idString(row.id), employeeId: row.employeeId === null ? null : idString(row.employeeId), status: row.status } : null;
  },

  async branchExists(executor, branchId) {
    const [row] = await executor.select({ id: branches.id }).from(branches)
      .where(and(eq(branches.id, numericId(branchId)), eq(branches.isActive, true))).limit(1);
    return Boolean(row);
  },

  async departmentBelongsToBranch(executor, departmentId, branchId) {
    const [row] = await executor.select({ id: departments.id }).from(departments)
      .where(and(eq(departments.id, numericId(departmentId)), eq(departments.branchId, numericId(branchId)), eq(departments.isActive, true))).limit(1);
    return Boolean(row);
  },

  async findDuplicateGrant(executor, input) {
    const branchCondition = input.branchId === null ? sql`${userAccountRoles.branchId} is null` : eq(userAccountRoles.branchId, numericId(input.branchId));
    const departmentCondition = input.departmentId === null ? sql`${userAccountRoles.departmentId} is null` : eq(userAccountRoles.departmentId, numericId(input.departmentId));
    const [row] = await executor.select({ id: userAccountRoles.id }).from(userAccountRoles).where(and(
      eq(userAccountRoles.userAccountId, numericId(input.accountId)),
      eq(userAccountRoles.roleId, numericId(input.roleId)),
      branchCondition,
      departmentCondition,
    )).limit(1);
    return row ? { id: idString(row.id) } : null;
  },

  async insertGrant(executor, input) {
    const [row] = await executor.insert(userAccountRoles).values({
      userAccountId: numericId(input.userAccountId),
      roleId: numericId(input.roleId),
      branchId: input.branchId === null ? null : numericId(input.branchId),
      departmentId: input.departmentId === null ? null : numericId(input.departmentId),
      grantedByUserAccountId: numericId(input.grantedByUserAccountId),
    }).returning();
    if (!row) throw new Error("Role grant insert did not return a row");
    return {
      id: idString(row.id), userAccountId: idString(row.userAccountId), roleId: idString(row.roleId),
      branchId: row.branchId === null ? null : idString(row.branchId),
      departmentId: row.departmentId === null ? null : idString(row.departmentId),
      grantedByUserAccountId: idString(row.grantedByUserAccountId!), grantedAt: row.grantedAt,
    };
  },

  async findGrantForAccount(executor, accountId, grantId) {
    const [row] = await executor.select({
      id: userAccountRoles.id, userAccountId: userAccountRoles.userAccountId, roleId: roles.id,
      roleCode: roles.code, roleScope: roles.scope, roleActive: roles.isActive,
      branchId: userAccountRoles.branchId, departmentId: userAccountRoles.departmentId,
    }).from(userAccountRoles).innerJoin(roles, eq(roles.id, userAccountRoles.roleId)).where(and(
      eq(userAccountRoles.id, numericId(grantId)), eq(userAccountRoles.userAccountId, numericId(accountId)),
    )).limit(1);
    return row ? {
      id: idString(row.id), userAccountId: idString(row.userAccountId), roleId: idString(row.roleId),
      roleCode: row.roleCode as RoleCode, roleScope: row.roleScope as RoleScope, roleActive: row.roleActive,
      branchId: row.branchId === null ? null : idString(row.branchId), departmentId: row.departmentId === null ? null : idString(row.departmentId),
    } : null;
  },

  async countActiveOwnerAccounts(executor) {
    const [row] = await executor.select({ count: sql<number>`count(distinct ${userAccounts.id})` })
      .from(userAccountRoles)
      .innerJoin(userAccounts, eq(userAccounts.id, userAccountRoles.userAccountId))
      .innerJoin(roles, eq(roles.id, userAccountRoles.roleId))
      .where(and(eq(roles.code, "OWNER"), eq(roles.isActive, true), eq(userAccounts.status, "active")));
    return Number(row?.count ?? 0);
  },

  async deleteGrant(executor, grantId) {
    await executor.delete(userAccountRoles).where(eq(userAccountRoles.id, numericId(grantId)));
  },
};
