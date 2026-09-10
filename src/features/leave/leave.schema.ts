import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  decimal,
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
  smallId,
  timestamps,
} from "../../db/schema.columns";
import {
  approvalActionTypeValues,
  leaveRequestStatusValues,
  quotaTypeValues,
} from "../../db/schema.enums";
import { workDayRecords } from "../attendance/attendance.schema";
import { employees } from "../employee/employee.schema";
import { userAccounts } from "../user-account/user-account.schema";

export const leaveTypes = mysqlTable(
  "leave_types",
  {
    id: smallId(),
    code: varchar("code", { length: 30 }).notNull().unique(),
    nameTh: varchar("name_th", { length: 100 }).notNull(),
    quotaType: mysqlEnum("quota_type", quotaTypeValues).notNull(),
    quotaDays: decimal("quota_days", { precision: 6, scale: 2 }),
    isDeductible: boolean("is_deductible").notNull(),
    requiresDocument: boolean("requires_document").notNull().default(false),
    allowExceed: boolean("allow_exceed").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    check(
      "chk_leave_type_quota_nonnegative",
      sql`${table.quotaDays} is null or ${table.quotaDays} >= 0`,
    ),
  ],
);

export const leaveRequests = mysqlTable(
  "leave_requests",
  {
    id: id(),
    employeeId: foreignId("employee_id")
      .notNull()
      .references(() => employees.id, restrict),
    originalLeaveTypeId: foreignSmallId("original_leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, restrict),
    finalLeaveTypeId: foreignSmallId("final_leave_type_id").references(
      () => leaveTypes.id,
      restrict,
    ),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    requestedDays: decimal("requested_days", {
      precision: 6,
      scale: 2,
    }).notNull(),
    reason: text("reason"),
    status: mysqlEnum("status", leaveRequestStatusValues)
      .notNull()
      .default("pending"),
    isRetroactive: boolean("is_retroactive").notNull().default(false),
    submittedByUserAccountId: foreignId("submitted_by_user_account_id")
      .notNull()
      .references(() => userAccounts.id, restrict),
    submittedAt: instant("submitted_at").notNull().defaultNow(),
    decidedAt: instant("decided_at"),
    ...timestamps,
  },
  (table) => [
    index("leave_requests_employee_period_idx").on(
      table.employeeId,
      table.startDate,
      table.endDate,
    ),
    index("leave_requests_status_idx").on(table.status),
    check(
      "chk_leave_request_period",
      sql`${table.endDate} >= ${table.startDate}`,
    ),
    check(
      "chk_requested_days_positive",
      sql`${table.requestedDays} > 0`,
    ),
  ],
);

export const leaveRequestDays = mysqlTable(
  "leave_request_days",
  {
    id: id(),
    leaveRequestId: foreignId("leave_request_id")
      .notNull()
      .references(() => leaveRequests.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    workDayRecordId: foreignId("work_day_record_id")
      .unique()
      .references(() => workDayRecords.id, {
        onDelete: "set null",
        onUpdate: "cascade",
      }),
    leaveTypeId: foreignSmallId("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, restrict),
    leaveDate: date("leave_date").notNull(),
    dayAmount: decimal("day_amount", { precision: 4, scale: 2 })
      .notNull()
      .default("1"),
    isPaid: boolean("is_paid").notNull(),
    isDeductible: boolean("is_deductible").notNull(),
    quotaConsumed: decimal("quota_consumed", { precision: 4, scale: 2 })
      .notNull()
      .default("0"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("leave_request_days_request_date_uidx").on(
      table.leaveRequestId,
      table.leaveDate,
    ),
    index("leave_request_days_date_type_idx").on(
      table.leaveDate,
      table.leaveTypeId,
    ),
    check(
      "chk_leave_day_amount",
      sql`${table.dayAmount} > 0 and ${table.dayAmount} <= 1`,
    ),
    check(
      "chk_quota_consumed",
      sql`${table.quotaConsumed} >= 0 and ${table.quotaConsumed} <= ${table.dayAmount}`,
    ),
  ],
);

export const leaveQuotas = mysqlTable(
  "leave_quotas",
  {
    id: id(),
    employeeId: foreignId("employee_id")
      .notNull()
      .references(() => employees.id, restrict),
    leaveTypeId: foreignSmallId("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, restrict),
    quotaYear: smallint("quota_year", { unsigned: true }).notNull(),
    entitledDays: decimal("entitled_days", {
      precision: 6,
      scale: 2,
    }).notNull(),
    usedDays: decimal("used_days", { precision: 6, scale: 2 })
      .notNull()
      .default("0"),
    lastRecalculatedAt: instant("last_recalculated_at"),
    frozenAt: instant("frozen_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("leave_quotas_employee_type_year_uidx").on(
      table.employeeId,
      table.leaveTypeId,
      table.quotaYear,
    ),
    check(
      "chk_entitled_days_nonnegative",
      sql`${table.entitledDays} >= 0`,
    ),
    check("chk_used_days_nonnegative", sql`${table.usedDays} >= 0`),
  ],
);

export const leaveApprovalActions = mysqlTable(
  "leave_approval_actions",
  {
    id: id(),
    leaveRequestId: foreignId("leave_request_id")
      .notNull()
      .references(() => leaveRequests.id, restrict),
    actorUserAccountId: foreignId("actor_user_account_id")
      .notNull()
      .references(() => userAccounts.id, restrict),
    action: mysqlEnum("action", approvalActionTypeValues).notNull(),
    fromLeaveTypeId: foreignSmallId("from_leave_type_id").references(
      () => leaveTypes.id,
      restrict,
    ),
    toLeaveTypeId: foreignSmallId("to_leave_type_id").references(
      () => leaveTypes.id,
      restrict,
    ),
    remark: text("remark"),
    actedAt: instant("acted_at").notNull().defaultNow(),
  },
  (table) => [
    index("leave_approval_actions_request_acted_idx").on(
      table.leaveRequestId,
      table.actedAt,
    ),
    index("leave_approval_actions_actor_idx").on(table.actorUserAccountId),
  ],
);
