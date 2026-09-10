// Defines MySQL persistence for employee advance requests.
import { sql } from "drizzle-orm";
import {
  check,
  date,
  decimal,
  foreignKey,
  index,
  mysqlEnum,
  mysqlTable,
  text,
  uniqueIndex,
} from "drizzle-orm/mysql-core";
import {
  foreignId,
  id,
  instant,
  restrict,
  setNull,
  timestamps,
} from "../../db/schema.columns";
import { advanceStatusValues } from "../../db/schema.enums";
import { employees } from "../employee/employee.schema";
import { userAccounts } from "../user-account/user-account.schema";

export const advanceRequests = mysqlTable(
  "advance_requests",
  {
    id: id(),
    employeeId: foreignId("employee_id")
      .notNull()
      .references(() => employees.id, restrict),
    requestMonth: date("request_month").notNull(),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    status: mysqlEnum("status", advanceStatusValues)
      .notNull()
      .default("pending"),
    requestedByUserAccountId: foreignId("requested_by_user_account_id").notNull(),
    requestedAt: instant("requested_at").notNull().defaultNow(),
    decidedByUserAccountId: foreignId("decided_by_user_account_id").references(
      () => userAccounts.id,
      setNull,
    ),
    decidedAt: instant("decided_at"),
    decisionNote: text("decision_note"),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      name: "advance_req_requested_by_fk",
      columns: [table.requestedByUserAccountId],
      foreignColumns: [userAccounts.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    uniqueIndex("advance_requests_employee_month_uidx").on(
      table.employeeId,
      table.requestMonth,
    ),
    index("advance_requests_status_idx").on(table.status),
    check("chk_advance_amount_positive", sql`${table.amount} > 0`),
    check(
      "chk_advance_request_month",
      sql`dayofmonth(${table.requestMonth}) = 1`,
    ),
  ],
);
