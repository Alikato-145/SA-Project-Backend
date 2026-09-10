import { sql } from "drizzle-orm";
import {
  check,
  date,
  decimal,
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
import {
  approvalActionTypeValues,
  overtimeStatusValues,
  overtimeTypeValues,
} from "../../db/schema.enums";
import { workDayRecords } from "../attendance/attendance.schema";
import { employees } from "../employee/employee.schema";
import { userAccounts } from "../user-account/user-account.schema";

export const overtimeRecords = mysqlTable(
  "overtime_records",
  {
    id: id(),
    employeeId: foreignId("employee_id")
      .notNull()
      .references(() => employees.id, restrict),
    workDayRecordId: foreignId("work_day_record_id").references(
      () => workDayRecords.id,
      setNull,
    ),
    overtimeDate: date("overtime_date").notNull(),
    overtimeType: mysqlEnum("overtime_type", overtimeTypeValues).notNull(),
    hours: decimal("hours", { precision: 6, scale: 2 }),
    dayUnits: decimal("day_units", { precision: 4, scale: 2 }),
    reason: text("reason"),
    status: mysqlEnum("status", overtimeStatusValues)
      .notNull()
      .default("pending"),
    requestedByUserAccountId: foreignId("requested_by_user_account_id")
      .notNull()
      .references(() => userAccounts.id, restrict),
    submittedAt: instant("submitted_at").notNull().defaultNow(),
    decidedAt: instant("decided_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("overtime_records_employee_date_uidx").on(
      table.employeeId,
      table.overtimeDate,
    ),
    index("overtime_records_status_idx").on(table.status),
    check(
      "chk_overtime_value_by_type",
      sql`(${table.overtimeType} = 'hourly' and ${table.hours} > 0 and ${table.dayUnits} is null) or (${table.overtimeType} in ('rest_day', 'public_holiday') and ${table.dayUnits} > 0 and ${table.dayUnits} <= 1 and ${table.hours} is null)`,
    ),
  ],
);

export const overtimeApprovalActions = mysqlTable(
  "overtime_approval_actions",
  {
    id: id(),
    overtimeRecordId: foreignId("overtime_record_id")
      .notNull()
      .references(() => overtimeRecords.id, restrict),
    actorUserAccountId: foreignId("actor_user_account_id")
      .notNull()
      .references(() => userAccounts.id, restrict),
    action: mysqlEnum("action", approvalActionTypeValues).notNull(),
    remark: text("remark"),
    actedAt: instant("acted_at").notNull().defaultNow(),
  },
  (table) => [
    index("overtime_approval_actions_record_acted_idx").on(
      table.overtimeRecordId,
      table.actedAt,
    ),
  ],
);
