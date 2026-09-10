// Defines MySQL persistence for daily employee attendance records.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  int,
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
import {
  timeEntrySourceValues,
  workDayStatusValues,
} from "../../db/schema.enums";
import { branches } from "../branch/branch.schema";
import { employees } from "../employee/employee.schema";
import { userAccounts } from "../user-account/user-account.schema";

export const workDayRecords = mysqlTable(
  "work_day_records",
  {
    id: id(),
    employeeId: foreignId("employee_id")
      .notNull()
      .references(() => employees.id, restrict),
    branchId: foreignId("branch_id")
      .notNull()
      .references(() => branches.id, restrict),
    workDate: date("work_date").notNull(),
    clockInAt: instant("clock_in_at"),
    clockOutAt: instant("clock_out_at"),
    status: mysqlEnum("status", workDayStatusValues).notNull(),
    lateMinutes: int("late_minutes").notNull().default(0),
    isDeductible: boolean("is_deductible").notNull().default(false),
    entrySource: mysqlEnum("entry_source", timeEntrySourceValues)
      .notNull()
      .default("manual"),
    createdByUserAccountId: foreignId("created_by_user_account_id").references(
      () => userAccounts.id,
      setNull,
    ),
    note: text("note"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("work_day_records_employee_date_uidx").on(
      table.employeeId,
      table.workDate,
    ),
    index("work_day_records_branch_date_idx").on(table.branchId, table.workDate),
    index("work_day_records_status_idx").on(table.status),
    check(
      "chk_clock_order",
      sql`${table.clockOutAt} is null or ${table.clockInAt} is null or ${table.clockOutAt} >= ${table.clockInAt}`,
    ),
    check(
      "chk_late_minutes_nonnegative",
      sql`${table.lateMinutes} >= 0`,
    ),
  ],
);
