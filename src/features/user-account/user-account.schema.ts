// Defines MySQL persistence for login accounts and scoped role grants.
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  mysqlEnum,
  mysqlTable,
  smallint,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import {
  foreignId,
  foreignSmallId,
  id,
  instant,
  restrict,
  timestamps,
} from "../../db/schema.columns";
import { accountStatusValues } from "../../db/schema.enums";
import { branches } from "../branch/branch.schema";
import { departments } from "../department/department.schema";
import { employees } from "../employee/employee.schema";
import { roles } from "../role/role.schema";

export const userAccounts = mysqlTable(
  "user_accounts",
  {
    id: id(),
    employeeId: foreignId("employee_id")
      .unique()
      .references(() => employees.id, restrict),
    username: varchar("username", { length: 100 }).notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    status: mysqlEnum("status", accountStatusValues)
      .notNull()
      .default("active"),
    failedLoginAttempts: smallint("failed_login_attempts").notNull().default(0),
    lockedUntil: instant("locked_until"),
    lastLoginAt: instant("last_login_at"),
    ...timestamps,
  },
  (table) => [
    check(
      "chk_login_attempts_nonnegative",
      sql`${table.failedLoginAttempts} >= 0`,
    ),
  ],
);

export const userAccountRoles = mysqlTable(
  "user_account_roles",
  {
    id: id(),
    userAccountId: foreignId("user_account_id")
      .notNull()
      .references(() => userAccounts.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    roleId: foreignSmallId("role_id")
      .notNull()
      .references(() => roles.id, restrict),
    branchId: foreignId("branch_id").references(() => branches.id, restrict),
    departmentId: foreignId("department_id").references(
      () => departments.id,
      restrict,
    ),
    grantedByUserAccountId: foreignId("granted_by_user_account_id"),
    grantedAt: instant("granted_at").notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "account_role_granted_by_fk",
      columns: [table.grantedByUserAccountId],
      foreignColumns: [userAccounts.id],
    })
      .onDelete("set null")
      .onUpdate("cascade"),
    uniqueIndex("user_account_roles_scope_uidx").on(
      table.userAccountId,
      table.roleId,
      table.branchId,
      table.departmentId,
    ),
    index("user_account_roles_user_idx").on(table.userAccountId),
    index("user_account_roles_role_idx").on(table.roleId),
  ],
);
