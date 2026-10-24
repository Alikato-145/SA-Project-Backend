// Defines PostgreSQL persistence for login accounts and scoped role grants.
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import {
  foreignId,
  foreignSmallId,
  id,
  instant,
  restrict,
  timestamps,
} from "../../db/schema.columns";
import { accountStatusEnum } from "../../db/schema.enums";
import { branches } from "../branch/branch.schema";
import { departments } from "../department/department.schema";
import { employees } from "../employee/employee.schema";
import { roles } from "../role/role.schema";

export const userAccounts = pgTable(
  "user_accounts",
  {
    id: id(),
    employeeId: foreignId("employee_id")
      .unique()
      .references(() => employees.id, restrict),
    username: varchar("username", { length: 100 }).notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    status: accountStatusEnum("status")
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

export const userAccountRoles = pgTable(
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

// Store fingerprints only; raw bearer tokens never enter persistence or audit data.
export const revokedSessionTokens = pgTable(
  "revoked_session_tokens",
  {
    id: id(),
    userAccountId: foreignId("user_account_id")
      .notNull()
      .references(() => userAccounts.id, restrict),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: instant("expires_at").notNull(),
    revokedAt: instant("revoked_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("revoked_session_tokens_hash_uidx").on(table.tokenHash),
    index("revoked_session_tokens_expiry_idx").on(table.expiresAt),
    check("chk_revoked_session_token_hash", sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
  ],
);
