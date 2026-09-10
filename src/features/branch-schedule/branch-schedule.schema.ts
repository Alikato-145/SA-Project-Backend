// Defines MySQL persistence for branch schedules and date overrides.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  mysqlTable,
  smallint,
  time,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import {
  foreignId,
  id,
  restrict,
  timestamps,
} from "../../db/schema.columns";
import { branches } from "../branch/branch.schema";
import { userAccounts } from "../user-account/user-account.schema";

export const branchSchedules = mysqlTable(
  "branch_schedules",
  {
    id: id(),
    branchId: foreignId("branch_id")
      .notNull()
      .references(() => branches.id, restrict),
    workStartTime: time("work_start_time").notNull(),
    standardCloseTime: time("standard_close_time")
      .notNull()
      .default("21:00:00"),
    lateGraceMinutes: smallint("late_grace_minutes").notNull().default(0),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("branch_schedules_branch_from_uidx").on(
      table.branchId,
      table.effectiveFrom,
    ),
    check(
      "chk_late_grace_nonnegative",
      sql`${table.lateGraceMinutes} >= 0`,
    ),
    check(
      "chk_branch_schedule_period",
      sql`${table.effectiveTo} is null or ${table.effectiveTo} >= ${table.effectiveFrom}`,
    ),
  ],
);

export const branchScheduleOverrides = mysqlTable(
  "branch_schedule_overrides",
  {
    id: id(),
    branchId: foreignId("branch_id")
      .notNull()
      .references(() => branches.id, restrict),
    scheduleDate: date("schedule_date").notNull(),
    workStartTime: time("work_start_time"),
    closeTime: time("close_time"),
    isClosed: boolean("is_closed").notNull().default(false),
    reason: varchar("reason", { length: 255 }),
    createdByUserAccountId: foreignId("created_by_user_account_id"),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      name: "branch_sched_override_created_by_fk",
      columns: [table.createdByUserAccountId],
      foreignColumns: [userAccounts.id],
    })
      .onDelete("set null")
      .onUpdate("cascade"),
    uniqueIndex("branch_schedule_overrides_branch_date_uidx").on(
      table.branchId,
      table.scheduleDate,
    ),
  ],
);
