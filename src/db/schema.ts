import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const id = (name = "id") =>
  bigint(name, { mode: "number" }).primaryKey().generatedByDefaultAsIdentity();
const sid = (name = "id") =>
  smallint(name).primaryKey().generatedByDefaultAsIdentity();
const fk = (name: string) => bigint(name, { mode: "number" });
const ts = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
const createdUpdated = {
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
};
const restrict = { onDelete: "restrict", onUpdate: "cascade" } as const;
const setNull = { onDelete: "set null", onUpdate: "cascade" } as const;

export const roleScope = pgEnum("role_scope", [
  "self",
  "department",
  "branch",
  "all",
]);
export const employeeStatus = pgEnum("employee_status", [
  "active",
  "inactive",
  "suspended",
  "terminated",
]);
export const accountStatus = pgEnum("account_status", [
  "active",
  "locked",
  "disabled",
]);
export const employmentType = pgEnum("employment_type", [
  "full_time",
  "part_time",
  "temporary",
]);
export const workDayStatus = pgEnum("work_day_status", [
  "present",
  "late",
  "absent",
  "leave",
  "weekly_holiday",
  "public_holiday",
]);
export const timeEntrySource = pgEnum("time_entry_source", [
  "manual",
  "import",
  "biometric",
]);
export const quotaType = pgEnum("quota_type", [
  "fixed",
  "by_seniority",
  "none",
]);
export const leaveRequestStatus = pgEnum("leave_request_status", [
  "draft",
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);
export const approvalActionType = pgEnum("approval_action_type", [
  "submitted",
  "forwarded",
  "approved",
  "rejected",
  "overridden",
  "type_changed",
  "cancelled",
]);
export const overtimeType = pgEnum("overtime_type", [
  "rest_day",
  "hourly",
  "public_holiday",
]);
export const overtimeStatus = pgEnum("overtime_status", [
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);
export const advanceStatus = pgEnum("advance_status", [
  "pending",
  "approved",
  "rejected",
  "deducted",
  "cancelled",
]);
export const loanStatus = pgEnum("loan_status", [
  "active",
  "closed",
  "cancelled",
]);
export const installmentStatus = pgEnum("installment_status", [
  "scheduled",
  "deducted",
  "waived",
  "cancelled",
]);
export const debtTransactionKind = pgEnum("debt_transaction_kind", [
  "charge",
  "adjustment",
  "reversal",
]);
export const payrollPeriodStatus = pgEnum("payroll_period_status", [
  "draft",
  "previewed",
  "locked",
]);
export const payrollRecordStatus = pgEnum("payroll_record_status", [
  "draft",
  "calculated",
  "locked",
]);
export const payrollItemDirection = pgEnum("payroll_item_direction", [
  "earning",
  "deduction",
]);
export const payrollItemType = pgEnum("payroll_item_type", [
  "base_salary",
  "welfare",
  "overtime_rest_day",
  "overtime_hourly",
  "overtime_public_holiday",
  "absence",
  "lateness",
  "sick_unpaid",
  "social_security",
  "advance",
  "loan_installment",
  "debt",
  "adjustment",
  "other",
]);
export const payrollAdjustmentStatus = pgEnum("payroll_adjustment_status", [
  "pending",
  "approved",
  "rejected",
  "applied",
]);
export const payslipStatus = pgEnum("payslip_status", ["generated", "voided"]);
export const emailDeliveryStatus = pgEnum("email_delivery_status", [
  "pending",
  "sent",
  "failed",
]);

export const shops = pgTable("shops", {
  id: id(),
  code: varchar("code", { length: 30 }).notNull().unique(),
  name: varchar("name", { length: 150 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  ...createdUpdated,
});

export const branches = pgTable(
  "branches",
  {
    id: id(),
    shopId: fk("shop_id")
      .notNull()
      .references(() => shops.id, restrict),
    code: varchar("code", { length: 30 }).notNull(),
    name: varchar("name", { length: 150 }).notNull(),
    address: text("address"),
    timezone: varchar("timezone", { length: 50 })
      .notNull()
      .default("Asia/Bangkok"),
    isActive: boolean("is_active").notNull().default(true),
    ...createdUpdated,
  },
  (t) => [
    uniqueIndex("branches_shop_code_uidx").on(t.shopId, t.code),
    index("branches_shop_idx").on(t.shopId),
  ],
);

export const departments = pgTable(
  "departments",
  {
    id: id(),
    branchId: fk("branch_id")
      .notNull()
      .references(() => branches.id, restrict),
    code: varchar("code", { length: 30 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...createdUpdated,
  },
  (t) => [
    uniqueIndex("departments_branch_code_uidx").on(t.branchId, t.code),
    index("departments_branch_idx").on(t.branchId),
  ],
);

export const positions = pgTable(
  "positions",
  {
    id: id(),
    shopId: fk("shop_id")
      .notNull()
      .references(() => shops.id, restrict),
    code: varchar("code", { length: 30 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...createdUpdated,
  },
  (t) => [uniqueIndex("positions_shop_code_uidx").on(t.shopId, t.code)],
);

export const roles = pgTable("roles", {
  id: sid(),
  code: varchar("code", { length: 30 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  scope: roleScope("scope").notNull(),
  isActive: boolean("is_active").notNull().default(true),
});

export const employees = pgTable(
  "employees",
  {
    id: id(),
    employeeCode: varchar("employee_code", { length: 30 }).notNull().unique(),
    nationalId: varchar("national_id", { length: 20 }).unique(),
    passportId: varchar("passport_id", { length: 30 }).unique(),
    firstName: varchar("first_name", { length: 100 }).notNull(),
    lastName: varchar("last_name", { length: 100 }).notNull(),
    phone: varchar("phone", { length: 30 }),
    personalEmail: varchar("personal_email", { length: 255 }),
    address: text("address"),
    hireDate: date("hire_date").notNull(),
    status: employeeStatus("status").notNull().default("active"),
    terminatedAt: date("terminated_at"),
    ...createdUpdated,
  },
  (t) => [
    check(
      "chk_employee_identity",
      sql`${t.nationalId} is not null or ${t.passportId} is not null`,
    ),
    check(
      "chk_employee_dates",
      sql`${t.terminatedAt} is null or ${t.terminatedAt} >= ${t.hireDate}`,
    ),
  ],
);

export const userAccounts = pgTable(
  "user_accounts",
  {
    id: id(),
    employeeId: fk("employee_id")
      .unique()
      .references(() => employees.id, restrict),
    username: varchar("username", { length: 100 }).notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    status: accountStatus("status").notNull().default("active"),
    failedLoginAttempts: smallint("failed_login_attempts").notNull().default(0),
    lockedUntil: ts("locked_until"),
    lastLoginAt: ts("last_login_at"),
    ...createdUpdated,
  },
  (t) => [
    check("chk_login_attempts_nonnegative", sql`${t.failedLoginAttempts} >= 0`),
  ],
);

export const userAccountRoles = pgTable(
  "user_account_roles",
  {
    id: id(),
    userAccountId: fk("user_account_id")
      .notNull()
      .references(() => userAccounts.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    roleId: smallint("role_id")
      .notNull()
      .references(() => roles.id, restrict),
    branchId: fk("branch_id").references(() => branches.id, restrict),
    departmentId: fk("department_id").references(
      () => departments.id,
      restrict,
    ),
    grantedByUserAccountId: fk("granted_by_user_account_id").references(
      () => userAccounts.id,
      setNull,
    ),
    grantedAt: ts("granted_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("user_account_roles_scope_uidx").on(
      t.userAccountId,
      t.roleId,
      t.branchId,
      t.departmentId,
    ),
    index("user_account_roles_user_idx").on(t.userAccountId),
    index("user_account_roles_role_idx").on(t.roleId),
  ],
);

export const employmentAssignments = pgTable(
  "employment_assignments",
  {
    id: id(),
    employeeId: fk("employee_id")
      .notNull()
      .references(() => employees.id, restrict),
    branchId: fk("branch_id")
      .notNull()
      .references(() => branches.id, restrict),
    departmentId: fk("department_id")
      .notNull()
      .references(() => departments.id, restrict),
    positionId: fk("position_id")
      .notNull()
      .references(() => positions.id, restrict),
    employmentType: employmentType("employment_type")
      .notNull()
      .default("full_time"),
    baseSalary: numeric("base_salary", { precision: 12, scale: 2 }).notNull(),
    welfareAmount: numeric("welfare_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    isPrimary: boolean("is_primary").notNull().default(true),
    createdByUserAccountId: fk("created_by_user_account_id").references(
      () => userAccounts.id,
      setNull,
    ),
    ...createdUpdated,
  },
  (t) => [
    uniqueIndex("employment_assignments_employee_from_uidx").on(
      t.employeeId,
      t.effectiveFrom,
    ),
    index("employment_assignments_branch_department_idx").on(
      t.branchId,
      t.departmentId,
    ),
    index("employment_assignments_position_idx").on(t.positionId),
    check("chk_assignment_salary_nonnegative", sql`${t.baseSalary} >= 0`),
    check("chk_assignment_welfare_nonnegative", sql`${t.welfareAmount} >= 0`),
    check(
      "chk_assignment_period",
      sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
  ],
);

export const employeeBankAccounts = pgTable(
  "employee_bank_accounts",
  {
    id: id(),
    employeeId: fk("employee_id")
      .notNull()
      .references(() => employees.id, restrict),
    bankCode: varchar("bank_code", { length: 20 }).notNull(),
    bankName: varchar("bank_name", { length: 100 }).notNull(),
    accountHolderName: varchar("account_holder_name", {
      length: 200,
    }).notNull(),
    accountNumberCiphertext: text("account_number_ciphertext").notNull(),
    accountNumberLast4: varchar("account_number_last4", {
      length: 4,
    }).notNull(),
    isPrimary: boolean("is_primary").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    ...createdUpdated,
  },
  (t) => [
    index("employee_bank_accounts_employee_idx").on(t.employeeId),
    uniqueIndex("employee_bank_accounts_active_primary_uidx")
      .on(t.employeeId)
      .where(sql`${t.isActive} and ${t.isPrimary}`),
  ],
);

export const employeeWeeklyHolidays = pgTable(
  "employee_weekly_holidays",
  {
    id: id(),
    employeeId: fk("employee_id")
      .notNull()
      .references(() => employees.id, restrict),
    weekday: smallint("weekday").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    ...createdUpdated,
  },
  (t) => [
    uniqueIndex("employee_weekly_holidays_uidx").on(
      t.employeeId,
      t.weekday,
      t.effectiveFrom,
    ),
    check("chk_weekday_range", sql`${t.weekday} between 0 and 6`),
    check(
      "chk_weekly_holiday_period",
      sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
  ],
);

export const branchSchedules = pgTable(
  "branch_schedules",
  {
    id: id(),
    branchId: fk("branch_id")
      .notNull()
      .references(() => branches.id, restrict),
    workStartTime: time("work_start_time").notNull(),
    standardCloseTime: time("standard_close_time")
      .notNull()
      .default("21:00:00"),
    lateGraceMinutes: smallint("late_grace_minutes").notNull().default(0),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    ...createdUpdated,
  },
  (t) => [
    uniqueIndex("branch_schedules_branch_from_uidx").on(
      t.branchId,
      t.effectiveFrom,
    ),
    check("chk_late_grace_nonnegative", sql`${t.lateGraceMinutes} >= 0`),
    check(
      "chk_branch_schedule_period",
      sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
  ],
);

export const branchScheduleOverrides = pgTable(
  "branch_schedule_overrides",
  {
    id: id(),
    branchId: fk("branch_id")
      .notNull()
      .references(() => branches.id, restrict),
    scheduleDate: date("schedule_date").notNull(),
    workStartTime: time("work_start_time"),
    closeTime: time("close_time"),
    isClosed: boolean("is_closed").notNull().default(false),
    reason: varchar("reason", { length: 255 }),
    createdByUserAccountId: fk("created_by_user_account_id").references(
      () => userAccounts.id,
      setNull,
    ),
    ...createdUpdated,
  },
  (t) => [
    uniqueIndex("branch_schedule_overrides_branch_date_uidx").on(
      t.branchId,
      t.scheduleDate,
    ),
  ],
);

export const holidayCalendars = pgTable(
  "holiday_calendars",
  {
    id: id(),
    shopId: fk("shop_id")
      .notNull()
      .references(() => shops.id, restrict),
    holidayDate: date("holiday_date").notNull(),
    name: varchar("name", { length: 150 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdByUserAccountId: fk("created_by_user_account_id").references(
      () => userAccounts.id,
      setNull,
    ),
    ...createdUpdated,
  },
  (t) => [
    uniqueIndex("holiday_calendars_shop_date_uidx").on(t.shopId, t.holidayDate),
  ],
);

export const workDayRecords = pgTable(
  "work_day_records",
  {
    id: id(),
    employeeId: fk("employee_id")
      .notNull()
      .references(() => employees.id, restrict),
    branchId: fk("branch_id")
      .notNull()
      .references(() => branches.id, restrict),
    workDate: date("work_date").notNull(),
    clockInAt: ts("clock_in_at"),
    clockOutAt: ts("clock_out_at"),
    status: workDayStatus("status").notNull(),
    lateMinutes: integer("late_minutes").notNull().default(0),
    isDeductible: boolean("is_deductible").notNull().default(false),
    entrySource: timeEntrySource("entry_source").notNull().default("manual"),
    createdByUserAccountId: fk("created_by_user_account_id").references(
      () => userAccounts.id,
      setNull,
    ),
    note: text("note"),
    ...createdUpdated,
  },
  (t) => [
    uniqueIndex("work_day_records_employee_date_uidx").on(
      t.employeeId,
      t.workDate,
    ),
    index("work_day_records_branch_date_idx").on(t.branchId, t.workDate),
    index("work_day_records_status_idx").on(t.status),
    check(
      "chk_clock_order",
      sql`${t.clockOutAt} is null or ${t.clockInAt} is null or ${t.clockOutAt} >= ${t.clockInAt}`,
    ),
    check("chk_late_minutes_nonnegative", sql`${t.lateMinutes} >= 0`),
  ],
);

export const leaveTypes = pgTable(
  "leave_types",
  {
    id: sid(),
    code: varchar("code", { length: 30 }).notNull().unique(),
    nameTh: varchar("name_th", { length: 100 }).notNull(),
    quotaType: quotaType("quota_type").notNull(),
    quotaDays: numeric("quota_days", { precision: 6, scale: 2 }),
    isDeductible: boolean("is_deductible").notNull(),
    requiresDocument: boolean("requires_document").notNull().default(false),
    allowExceed: boolean("allow_exceed").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    ...createdUpdated,
  },
  (t) => [
    check(
      "chk_leave_type_quota_nonnegative",
      sql`${t.quotaDays} is null or ${t.quotaDays} >= 0`,
    ),
  ],
);

export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: id(),
    employeeId: fk("employee_id")
      .notNull()
      .references(() => employees.id, restrict),
    originalLeaveTypeId: smallint("original_leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, restrict),
    finalLeaveTypeId: smallint("final_leave_type_id").references(
      () => leaveTypes.id,
      restrict,
    ),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    requestedDays: numeric("requested_days", {
      precision: 6,
      scale: 2,
    }).notNull(),
    reason: text("reason"),
    status: leaveRequestStatus("status").notNull().default("pending"),
    isRetroactive: boolean("is_retroactive").notNull().default(false),
    submittedByUserAccountId: fk("submitted_by_user_account_id")
      .notNull()
      .references(() => userAccounts.id, restrict),
    submittedAt: ts("submitted_at").notNull().defaultNow(),
    decidedAt: ts("decided_at"),
    ...createdUpdated,
  },
  (t) => [
    index("leave_requests_employee_period_idx").on(
      t.employeeId,
      t.startDate,
      t.endDate,
    ),
    index("leave_requests_status_idx").on(t.status),
    check("chk_leave_request_period", sql`${t.endDate} >= ${t.startDate}`),
    check("chk_requested_days_positive", sql`${t.requestedDays} > 0`),
  ],
);

export const leaveRequestDays = pgTable(
  "leave_request_days",
  {
    id: id(),
    leaveRequestId: fk("leave_request_id")
      .notNull()
      .references(() => leaveRequests.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    workDayRecordId: fk("work_day_record_id")
      .unique()
      .references(() => workDayRecords.id, setNull),
    leaveTypeId: smallint("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, restrict),
    leaveDate: date("leave_date").notNull(),
    dayAmount: numeric("day_amount", { precision: 4, scale: 2 })
      .notNull()
      .default("1"),
    isPaid: boolean("is_paid").notNull(),
    isDeductible: boolean("is_deductible").notNull(),
    quotaConsumed: numeric("quota_consumed", { precision: 4, scale: 2 })
      .notNull()
      .default("0"),
    ...createdUpdated,
  },
  (t) => [
    uniqueIndex("leave_request_days_request_date_uidx").on(
      t.leaveRequestId,
      t.leaveDate,
    ),
    index("leave_request_days_date_type_idx").on(t.leaveDate, t.leaveTypeId),
    check(
      "chk_leave_day_amount",
      sql`${t.dayAmount} > 0 and ${t.dayAmount} <= 1`,
    ),
    check(
      "chk_quota_consumed",
      sql`${t.quotaConsumed} >= 0 and ${t.quotaConsumed} <= ${t.dayAmount}`,
    ),
  ],
);

export const leaveQuotas = pgTable(
  "leave_quotas",
  {
    id: id(),
    employeeId: fk("employee_id")
      .notNull()
      .references(() => employees.id, restrict),
    leaveTypeId: smallint("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, restrict),
    quotaYear: smallint("quota_year").notNull(),
    entitledDays: numeric("entitled_days", {
      precision: 6,
      scale: 2,
    }).notNull(),
    usedDays: numeric("used_days", { precision: 6, scale: 2 })
      .notNull()
      .default("0"),
    lastRecalculatedAt: ts("last_recalculated_at"),
    frozenAt: ts("frozen_at"),
    ...createdUpdated,
  },
  (t) => [
    uniqueIndex("leave_quotas_employee_type_year_uidx").on(
      t.employeeId,
      t.leaveTypeId,
      t.quotaYear,
    ),
    check("chk_entitled_days_nonnegative", sql`${t.entitledDays} >= 0`),
    check("chk_used_days_nonnegative", sql`${t.usedDays} >= 0`),
  ],
);

export const leaveApprovalActions = pgTable(
  "leave_approval_actions",
  {
    id: id(),
    leaveRequestId: fk("leave_request_id")
      .notNull()
      .references(() => leaveRequests.id, restrict),
    actorUserAccountId: fk("actor_user_account_id")
      .notNull()
      .references(() => userAccounts.id, restrict),
    action: approvalActionType("action").notNull(),
    fromLeaveTypeId: smallint("from_leave_type_id").references(
      () => leaveTypes.id,
      restrict,
    ),
    toLeaveTypeId: smallint("to_leave_type_id").references(
      () => leaveTypes.id,
      restrict,
    ),
    remark: text("remark"),
    actedAt: ts("acted_at").notNull().defaultNow(),
  },
  (t) => [
    index("leave_approval_actions_request_acted_idx").on(
      t.leaveRequestId,
      t.actedAt,
    ),
    index("leave_approval_actions_actor_idx").on(t.actorUserAccountId),
  ],
);

export const overtimeRecords = pgTable(
  "overtime_records",
  {
    id: id(),
    employeeId: fk("employee_id")
      .notNull()
      .references(() => employees.id, restrict),
    workDayRecordId: fk("work_day_record_id").references(
      () => workDayRecords.id,
      setNull,
    ),
    overtimeDate: date("overtime_date").notNull(),
    overtimeType: overtimeType("overtime_type").notNull(),
    hours: numeric("hours", { precision: 6, scale: 2 }),
    dayUnits: numeric("day_units", { precision: 4, scale: 2 }),
    reason: text("reason"),
    status: overtimeStatus("status").notNull().default("pending"),
    requestedByUserAccountId: fk("requested_by_user_account_id")
      .notNull()
      .references(() => userAccounts.id, restrict),
    submittedAt: ts("submitted_at").notNull().defaultNow(),
    decidedAt: ts("decided_at"),
    ...createdUpdated,
  },
  (t) => [
    uniqueIndex("overtime_records_employee_date_uidx").on(
      t.employeeId,
      t.overtimeDate,
    ),
    index("overtime_records_status_idx").on(t.status),
    check(
      "chk_overtime_value_by_type",
      sql`(${t.overtimeType} = 'hourly' and ${t.hours} > 0 and ${t.dayUnits} is null) or (${t.overtimeType} in ('rest_day','public_holiday') and ${t.dayUnits} > 0 and ${t.dayUnits} <= 1 and ${t.hours} is null)`,
    ),
  ],
);

export const overtimeApprovalActions = pgTable(
  "overtime_approval_actions",
  {
    id: id(),
    overtimeRecordId: fk("overtime_record_id")
      .notNull()
      .references(() => overtimeRecords.id, restrict),
    actorUserAccountId: fk("actor_user_account_id")
      .notNull()
      .references(() => userAccounts.id, restrict),
    action: approvalActionType("action").notNull(),
    remark: text("remark"),
    actedAt: ts("acted_at").notNull().defaultNow(),
  },
  (t) => [
    index("overtime_approval_actions_record_acted_idx").on(
      t.overtimeRecordId,
      t.actedAt,
    ),
  ],
);

export const advanceRequests = pgTable(
  "advance_requests",
  {
    id: id(),
    employeeId: fk("employee_id")
      .notNull()
      .references(() => employees.id, restrict),
    requestMonth: date("request_month").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    status: advanceStatus("status").notNull().default("pending"),
    requestedByUserAccountId: fk("requested_by_user_account_id")
      .notNull()
      .references(() => userAccounts.id, restrict),
    requestedAt: ts("requested_at").notNull().defaultNow(),
    decidedByUserAccountId: fk("decided_by_user_account_id").references(
      () => userAccounts.id,
      setNull,
    ),
    decidedAt: ts("decided_at"),
    decisionNote: text("decision_note"),
    ...createdUpdated,
  },
  (t) => [
    uniqueIndex("advance_requests_employee_month_uidx").on(
      t.employeeId,
      t.requestMonth,
    ),
    index("advance_requests_status_idx").on(t.status),
    check("chk_advance_amount_positive", sql`${t.amount} > 0`),
    check(
      "chk_advance_request_month",
      sql`extract(day from ${t.requestMonth}) = 1`,
    ),
  ],
);

export const loans = pgTable(
  "loans",
  {
    id: id(),
    employeeId: fk("employee_id")
      .notNull()
      .references(() => employees.id, restrict),
    principalAmount: numeric("principal_amount", {
      precision: 12,
      scale: 2,
    }).notNull(),
    reason: text("reason").notNull(),
    installmentCount: smallint("installment_count").notNull(),
    status: loanStatus("status").notNull().default("active"),
    approvedByUserAccountId: fk("approved_by_user_account_id")
      .notNull()
      .references(() => userAccounts.id, restrict),
    approvedAt: ts("approved_at").notNull(),
    closedAt: ts("closed_at"),
    ...createdUpdated,
  },
  (t) => [
    index("loans_employee_status_idx").on(t.employeeId, t.status),
    check("chk_loan_principal_positive", sql`${t.principalAmount} > 0`),
    check(
      "chk_loan_installment_count",
      sql`${t.installmentCount} between 1 and 5`,
    ),
  ],
);

export const debtTypes = pgTable("debt_types", {
  id: sid(),
  code: varchar("code", { length: 30 }).notNull().unique(),
  nameTh: varchar("name_th", { length: 100 }).notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  ...createdUpdated,
});

export const payrollConfigurations = pgTable(
  "payroll_configurations",
  {
    id: id(),
    shopId: fk("shop_id")
      .notNull()
      .references(() => shops.id, restrict),
    branchId: fk("branch_id").references(() => branches.id, restrict),
    configKey: varchar("config_key", { length: 50 }).notNull(),
    numericValue: numeric("numeric_value", {
      precision: 14,
      scale: 4,
    }).notNull(),
    unit: varchar("unit", { length: 30 }).notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    createdByUserAccountId: fk("created_by_user_account_id")
      .notNull()
      .references(() => userAccounts.id, restrict),
    ...createdUpdated,
  },
  (t) => [
    uniqueIndex("payroll_configurations_scope_key_from_uidx").on(
      t.shopId,
      t.branchId,
      t.configKey,
      t.effectiveFrom,
    ),
    index("payroll_configurations_key_from_idx").on(
      t.configKey,
      t.effectiveFrom,
    ),
    check("chk_config_value_nonnegative", sql`${t.numericValue} >= 0`),
    check(
      "chk_payroll_config_period",
      sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
  ],
);

export const payrollPeriods = pgTable(
  "payroll_periods",
  {
    id: id(),
    shopId: fk("shop_id")
      .notNull()
      .references(() => shops.id, restrict),
    periodYear: smallint("period_year").notNull(),
    periodMonth: smallint("period_month").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    status: payrollPeriodStatus("status").notNull().default("draft"),
    createdByUserAccountId: fk("created_by_user_account_id")
      .notNull()
      .references(() => userAccounts.id, restrict),
    previewedAt: ts("previewed_at"),
    lockedByUserAccountId: fk("locked_by_user_account_id").references(
      () => userAccounts.id,
      setNull,
    ),
    lockedAt: ts("locked_at"),
    ...createdUpdated,
  },
  (t) => [
    uniqueIndex("payroll_periods_shop_year_month_uidx").on(
      t.shopId,
      t.periodYear,
      t.periodMonth,
    ),
    index("payroll_periods_status_idx").on(t.status),
    check("chk_payroll_month", sql`${t.periodMonth} between 1 and 12`),
    check("chk_payroll_period_dates", sql`${t.endDate} >= ${t.startDate}`),
  ],
);

export const payrollRecords = pgTable(
  "payroll_records",
  {
    id: id(),
    payrollPeriodId: fk("payroll_period_id")
      .notNull()
      .references(() => payrollPeriods.id, restrict),
    employeeId: fk("employee_id")
      .notNull()
      .references(() => employees.id, restrict),
    employmentAssignmentId: fk("employment_assignment_id")
      .notNull()
      .references(() => employmentAssignments.id, restrict),
    status: payrollRecordStatus("status").notNull().default("draft"),
    baseSalarySnapshot: numeric("base_salary_snapshot", {
      precision: 12,
      scale: 2,
    }).notNull(),
    welfareSnapshot: numeric("welfare_snapshot", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    totalEarnings: numeric("total_earnings", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    totalDeductions: numeric("total_deductions", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    netPay: numeric("net_pay", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    calculatedAt: ts("calculated_at"),
    calculatedByUserAccountId: fk("calculated_by_user_account_id").references(
      () => userAccounts.id,
      setNull,
    ),
    lockedAt: ts("locked_at"),
    ...createdUpdated,
  },
  (t) => [
    uniqueIndex("payroll_records_period_employee_uidx").on(
      t.payrollPeriodId,
      t.employeeId,
    ),
    index("payroll_records_employee_idx").on(t.employeeId),
    check("chk_payroll_base_salary", sql`${t.baseSalarySnapshot} >= 0`),
    check("chk_payroll_welfare", sql`${t.welfareSnapshot} >= 0`),
    check("chk_total_earnings", sql`${t.totalEarnings} >= 0`),
    check("chk_total_deductions", sql`${t.totalDeductions} >= 0`),
    check("chk_net_pay_nonnegative", sql`${t.netPay} >= 0`),
    check(
      "chk_payroll_totals",
      sql`${t.netPay} = ${t.totalEarnings} - ${t.totalDeductions}`,
    ),
  ],
);

export const loanInstallments = pgTable(
  "loan_installments",
  {
    id: id(),
    loanId: fk("loan_id")
      .notNull()
      .references(() => loans.id, restrict),
    installmentNo: smallint("installment_no").notNull(),
    duePeriodStart: date("due_period_start").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    status: installmentStatus("status").notNull().default("scheduled"),
    deductedAt: ts("deducted_at"),
    payrollRecordId: fk("payroll_record_id").references(
      () => payrollRecords.id,
      setNull,
    ),
    ...createdUpdated,
  },
  (t) => [
    uniqueIndex("loan_installments_loan_no_uidx").on(t.loanId, t.installmentNo),
    index("loan_installments_due_status_idx").on(t.duePeriodStart, t.status),
    check("chk_installment_no_positive", sql`${t.installmentNo} > 0`),
    check("chk_installment_amount_positive", sql`${t.amount} > 0`),
  ],
);

export const debtTransactions = pgTable(
  "debt_transactions",
  {
    id: id(),
    employeeId: fk("employee_id")
      .notNull()
      .references(() => employees.id, restrict),
    debtTypeId: smallint("debt_type_id")
      .notNull()
      .references(() => debtTypes.id, restrict),
    transactionKind: debtTransactionKind("transaction_kind")
      .notNull()
      .default("charge"),
    transactionDate: date("transaction_date").notNull(),
    description: text("description").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    originalTransactionId: fk("original_transaction_id").references(
      (): AnyPgColumn => debtTransactions.id,
      restrict,
    ),
    recordedByUserAccountId: fk("recorded_by_user_account_id")
      .notNull()
      .references(() => userAccounts.id, restrict),
    settledInPayrollRecordId: fk("settled_in_payroll_record_id").references(
      () => payrollRecords.id,
      setNull,
    ),
    settledAt: ts("settled_at"),
    ...createdUpdated,
  },
  (t) => [
    index("debt_transactions_employee_date_idx").on(
      t.employeeId,
      t.transactionDate,
    ),
    index("debt_transactions_employee_settled_idx").on(
      t.employeeId,
      t.settledAt,
    ),
    index("debt_transactions_type_idx").on(t.debtTypeId),
    check("chk_debt_amount_positive", sql`${t.amount} > 0`),
  ],
);

export const payrollItems = pgTable(
  "payroll_items",
  {
    id: id(),
    payrollRecordId: fk("payroll_record_id")
      .notNull()
      .references(() => payrollRecords.id, restrict),
    itemType: payrollItemType("item_type").notNull(),
    direction: payrollItemDirection("direction").notNull(),
    description: varchar("description", { length: 255 }).notNull(),
    quantity: numeric("quantity", { precision: 10, scale: 2 }),
    rate: numeric("rate", { precision: 14, scale: 4 }),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    payrollConfigurationId: fk("payroll_configuration_id").references(
      () => payrollConfigurations.id,
      setNull,
    ),
    sourceTable: varchar("source_table", { length: 80 }),
    sourceId: fk("source_id"),
    occurredOn: date("occurred_on"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("payroll_items_record_direction_idx").on(
      t.payrollRecordId,
      t.direction,
    ),
    index("payroll_items_source_idx").on(t.sourceTable, t.sourceId),
    check("chk_payroll_item_amount", sql`${t.amount} >= 0`),
    check(
      "chk_payroll_item_quantity",
      sql`${t.quantity} is null or ${t.quantity} >= 0`,
    ),
    check("chk_payroll_item_rate", sql`${t.rate} is null or ${t.rate} >= 0`),
    check(
      "chk_payroll_item_source_pair",
      sql`(${t.sourceTable} is null) = (${t.sourceId} is null)`,
    ),
  ],
);

export const payrollAdjustments = pgTable(
  "payroll_adjustments",
  {
    id: id(),
    originalPayrollRecordId: fk("original_payroll_record_id")
      .notNull()
      .references(() => payrollRecords.id, restrict),
    appliedPayrollPeriodId: fk("applied_payroll_period_id").references(
      () => payrollPeriods.id,
      restrict,
    ),
    direction: payrollItemDirection("direction").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    reason: text("reason").notNull(),
    status: payrollAdjustmentStatus("status").notNull().default("pending"),
    requestedByUserAccountId: fk("requested_by_user_account_id")
      .notNull()
      .references(() => userAccounts.id, restrict),
    requestedAt: ts("requested_at").notNull().defaultNow(),
    approvedByUserAccountId: fk("approved_by_user_account_id").references(
      () => userAccounts.id,
      setNull,
    ),
    approvedAt: ts("approved_at"),
    appliedPayrollItemId: fk("applied_payroll_item_id")
      .unique()
      .references(() => payrollItems.id, setNull),
  },
  (t) => [
    index("payroll_adjustments_original_status_idx").on(
      t.originalPayrollRecordId,
      t.status,
    ),
    check("chk_adjustment_amount_positive", sql`${t.amount} > 0`),
  ],
);

export const payslips = pgTable("payslips", {
  id: id(),
  payrollRecordId: fk("payroll_record_id")
    .notNull()
    .unique()
    .references(() => payrollRecords.id, restrict),
  fileStorageKey: text("file_storage_key").notNull(),
  fileSha256: varchar("file_sha256", { length: 64 }).notNull(),
  status: payslipStatus("status").notNull().default("generated"),
  generatedAt: ts("generated_at").notNull().defaultNow(),
  generatedByUserAccountId: fk("generated_by_user_account_id").references(
    () => userAccounts.id,
    setNull,
  ),
  voidedAt: ts("voided_at"),
  voidedByUserAccountId: fk("voided_by_user_account_id").references(
    () => userAccounts.id,
    setNull,
  ),
});

export const emailDeliveryLogs = pgTable(
  "email_delivery_logs",
  {
    id: id(),
    payslipId: fk("payslip_id")
      .notNull()
      .references(() => payslips.id, restrict),
    recipientEmail: varchar("recipient_email", { length: 255 }).notNull(),
    status: emailDeliveryStatus("status").notNull().default("pending"),
    providerMessageId: varchar("provider_message_id", { length: 255 }),
    attemptedAt: ts("attempted_at").notNull().defaultNow(),
    sentAt: ts("sent_at"),
    errorMessage: text("error_message"),
  },
  (t) => [
    index("email_delivery_logs_payslip_attempted_idx").on(
      t.payslipId,
      t.attemptedAt,
    ),
    index("email_delivery_logs_status_idx").on(t.status),
  ],
);

export const attachments = pgTable(
  "attachments",
  {
    id: id(),
    employeeId: fk("employee_id").references(() => employees.id, restrict),
    leaveRequestId: fk("leave_request_id").references(
      () => leaveRequests.id,
      restrict,
    ),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: varchar("mime_type", { length: 100 }).notNull(),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }).notNull(),
    fileSha256: varchar("file_sha256", { length: 64 }).notNull(),
    uploadedByUserAccountId: fk("uploaded_by_user_account_id")
      .notNull()
      .references(() => userAccounts.id, restrict),
    uploadedAt: ts("uploaded_at").notNull().defaultNow(),
  },
  (t) => [
    index("attachments_employee_idx").on(t.employeeId),
    index("attachments_leave_request_idx").on(t.leaveRequestId),
    check(
      "chk_attachment_single_owner",
      sql`(${t.employeeId} is not null and ${t.leaveRequestId} is null) or (${t.employeeId} is null and ${t.leaveRequestId} is not null)`,
    ),
    check("chk_attachment_size_positive", sql`${t.fileSizeBytes} > 0`),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    actorUserAccountId: fk("actor_user_account_id").references(
      () => userAccounts.id,
      setNull,
    ),
    action: varchar("action", { length: 80 }).notNull(),
    tableName: varchar("table_name", { length: 100 }).notNull(),
    recordId: varchar("record_id", { length: 100 }).notNull(),
    oldData: jsonb("old_data").$type<Record<string, unknown>>(),
    newData: jsonb("new_data").$type<Record<string, unknown>>(),
    reason: text("reason"),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
    requestId: varchar("request_id", { length: 100 }),
  },
  (t) => [
    index("audit_logs_target_occurred_idx").on(
      t.tableName,
      t.recordId,
      t.occurredAt,
    ),
    index("audit_logs_actor_occurred_idx").on(
      t.actorUserAccountId,
      t.occurredAt,
    ),
  ],
);

// Relations are explicitly named where a table has multiple FKs to the same target.
export const shopsRelations = relations(shops, ({ many }) => ({
  branches: many(branches),
  positions: many(positions),
  holidays: many(holidayCalendars),
  payrollConfigurations: many(payrollConfigurations),
  payrollPeriods: many(payrollPeriods),
}));
export const branchesRelations = relations(branches, ({ one, many }) => ({
  shop: one(shops, { fields: [branches.shopId], references: [shops.id] }),
  departments: many(departments),
  employmentAssignments: many(employmentAssignments),
  schedules: many(branchSchedules),
  scheduleOverrides: many(branchScheduleOverrides),
  workDayRecords: many(workDayRecords),
  scopedRoles: many(userAccountRoles),
  payrollConfigurations: many(payrollConfigurations),
}));
export const departmentsRelations = relations(departments, ({ one, many }) => ({
  branch: one(branches, {
    fields: [departments.branchId],
    references: [branches.id],
  }),
  employmentAssignments: many(employmentAssignments),
  scopedRoles: many(userAccountRoles),
}));
export const positionsRelations = relations(positions, ({ one, many }) => ({
  shop: one(shops, { fields: [positions.shopId], references: [shops.id] }),
  employmentAssignments: many(employmentAssignments),
}));
export const rolesRelations = relations(roles, ({ many }) => ({
  accountRoles: many(userAccountRoles),
}));
export const employeesRelations = relations(employees, ({ one, many }) => ({
  userAccount: one(userAccounts),
  employmentAssignments: many(employmentAssignments),
  bankAccounts: many(employeeBankAccounts),
  weeklyHolidays: many(employeeWeeklyHolidays),
  workDayRecords: many(workDayRecords),
  leaveRequests: many(leaveRequests),
  leaveQuotas: many(leaveQuotas),
  overtimeRecords: many(overtimeRecords),
  advanceRequests: many(advanceRequests),
  loans: many(loans),
  debtTransactions: many(debtTransactions),
  payrollRecords: many(payrollRecords),
  attachments: many(attachments),
}));
export const userAccountsRelations = relations(
  userAccounts,
  ({ one, many }) => ({
    employee: one(employees, {
      fields: [userAccounts.employeeId],
      references: [employees.id],
    }),
    accountRoles: many(userAccountRoles, { relationName: "accountRoles" }),
    grantedRoles: many(userAccountRoles, { relationName: "grantedRoles" }),
    submittedLeaveRequests: many(leaveRequests),
    recordedWorkDays: many(workDayRecords),
    requestedAdvances: many(advanceRequests, {
      relationName: "advanceRequestedBy",
    }),
    decidedAdvances: many(advanceRequests, {
      relationName: "advanceDecidedBy",
    }),
    approvedLoans: many(loans),
    createdPayrollPeriods: many(payrollPeriods, {
      relationName: "payrollPeriodCreatedBy",
    }),
    lockedPayrollPeriods: many(payrollPeriods, {
      relationName: "payrollPeriodLockedBy",
    }),
    requestedPayrollAdjustments: many(payrollAdjustments, {
      relationName: "adjustmentRequestedBy",
    }),
    approvedPayrollAdjustments: many(payrollAdjustments, {
      relationName: "adjustmentApprovedBy",
    }),
    generatedPayslips: many(payslips, { relationName: "payslipGeneratedBy" }),
    voidedPayslips: many(payslips, { relationName: "payslipVoidedBy" }),
    auditLogs: many(auditLogs),
  }),
);
export const userAccountRolesRelations = relations(
  userAccountRoles,
  ({ one }) => ({
    userAccount: one(userAccounts, {
      fields: [userAccountRoles.userAccountId],
      references: [userAccounts.id],
      relationName: "accountRoles",
    }),
    role: one(roles, {
      fields: [userAccountRoles.roleId],
      references: [roles.id],
    }),
    branch: one(branches, {
      fields: [userAccountRoles.branchId],
      references: [branches.id],
    }),
    department: one(departments, {
      fields: [userAccountRoles.departmentId],
      references: [departments.id],
    }),
    grantedBy: one(userAccounts, {
      fields: [userAccountRoles.grantedByUserAccountId],
      references: [userAccounts.id],
      relationName: "grantedRoles",
    }),
  }),
);
export const employmentAssignmentsRelations = relations(
  employmentAssignments,
  ({ one, many }) => ({
    employee: one(employees, {
      fields: [employmentAssignments.employeeId],
      references: [employees.id],
    }),
    branch: one(branches, {
      fields: [employmentAssignments.branchId],
      references: [branches.id],
    }),
    department: one(departments, {
      fields: [employmentAssignments.departmentId],
      references: [departments.id],
    }),
    position: one(positions, {
      fields: [employmentAssignments.positionId],
      references: [positions.id],
    }),
    createdBy: one(userAccounts, {
      fields: [employmentAssignments.createdByUserAccountId],
      references: [userAccounts.id],
    }),
    payrollRecords: many(payrollRecords),
  }),
);
export const employeeBankAccountsRelations = relations(
  employeeBankAccounts,
  ({ one }) => ({
    employee: one(employees, {
      fields: [employeeBankAccounts.employeeId],
      references: [employees.id],
    }),
  }),
);
export const employeeWeeklyHolidaysRelations = relations(
  employeeWeeklyHolidays,
  ({ one }) => ({
    employee: one(employees, {
      fields: [employeeWeeklyHolidays.employeeId],
      references: [employees.id],
    }),
  }),
);
export const branchSchedulesRelations = relations(
  branchSchedules,
  ({ one }) => ({
    branch: one(branches, {
      fields: [branchSchedules.branchId],
      references: [branches.id],
    }),
  }),
);
export const branchScheduleOverridesRelations = relations(
  branchScheduleOverrides,
  ({ one }) => ({
    branch: one(branches, {
      fields: [branchScheduleOverrides.branchId],
      references: [branches.id],
    }),
    createdBy: one(userAccounts, {
      fields: [branchScheduleOverrides.createdByUserAccountId],
      references: [userAccounts.id],
    }),
  }),
);
export const holidayCalendarsRelations = relations(
  holidayCalendars,
  ({ one }) => ({
    shop: one(shops, {
      fields: [holidayCalendars.shopId],
      references: [shops.id],
    }),
    createdBy: one(userAccounts, {
      fields: [holidayCalendars.createdByUserAccountId],
      references: [userAccounts.id],
    }),
  }),
);
export const workDayRecordsRelations = relations(
  workDayRecords,
  ({ one, many }) => ({
    employee: one(employees, {
      fields: [workDayRecords.employeeId],
      references: [employees.id],
    }),
    branch: one(branches, {
      fields: [workDayRecords.branchId],
      references: [branches.id],
    }),
    createdBy: one(userAccounts, {
      fields: [workDayRecords.createdByUserAccountId],
      references: [userAccounts.id],
    }),
    leaveRequestDay: one(leaveRequestDays),
    overtimeRecords: many(overtimeRecords),
  }),
);
export const leaveTypesRelations = relations(leaveTypes, ({ many }) => ({
  originalLeaveRequests: many(leaveRequests, {
    relationName: "originalLeaveType",
  }),
  finalLeaveRequests: many(leaveRequests, { relationName: "finalLeaveType" }),
  leaveRequestDays: many(leaveRequestDays),
  leaveQuotas: many(leaveQuotas),
  actionsFrom: many(leaveApprovalActions, { relationName: "fromLeaveType" }),
  actionsTo: many(leaveApprovalActions, { relationName: "toLeaveType" }),
}));
export const leaveRequestsRelations = relations(
  leaveRequests,
  ({ one, many }) => ({
    employee: one(employees, {
      fields: [leaveRequests.employeeId],
      references: [employees.id],
    }),
    originalLeaveType: one(leaveTypes, {
      fields: [leaveRequests.originalLeaveTypeId],
      references: [leaveTypes.id],
      relationName: "originalLeaveType",
    }),
    finalLeaveType: one(leaveTypes, {
      fields: [leaveRequests.finalLeaveTypeId],
      references: [leaveTypes.id],
      relationName: "finalLeaveType",
    }),
    submittedBy: one(userAccounts, {
      fields: [leaveRequests.submittedByUserAccountId],
      references: [userAccounts.id],
    }),
    days: many(leaveRequestDays),
    approvalActions: many(leaveApprovalActions),
    attachments: many(attachments),
  }),
);
export const leaveRequestDaysRelations = relations(
  leaveRequestDays,
  ({ one }) => ({
    leaveRequest: one(leaveRequests, {
      fields: [leaveRequestDays.leaveRequestId],
      references: [leaveRequests.id],
    }),
    workDayRecord: one(workDayRecords, {
      fields: [leaveRequestDays.workDayRecordId],
      references: [workDayRecords.id],
    }),
    leaveType: one(leaveTypes, {
      fields: [leaveRequestDays.leaveTypeId],
      references: [leaveTypes.id],
    }),
  }),
);
export const leaveQuotasRelations = relations(leaveQuotas, ({ one }) => ({
  employee: one(employees, {
    fields: [leaveQuotas.employeeId],
    references: [employees.id],
  }),
  leaveType: one(leaveTypes, {
    fields: [leaveQuotas.leaveTypeId],
    references: [leaveTypes.id],
  }),
}));
export const leaveApprovalActionsRelations = relations(
  leaveApprovalActions,
  ({ one }) => ({
    leaveRequest: one(leaveRequests, {
      fields: [leaveApprovalActions.leaveRequestId],
      references: [leaveRequests.id],
    }),
    actor: one(userAccounts, {
      fields: [leaveApprovalActions.actorUserAccountId],
      references: [userAccounts.id],
    }),
    fromLeaveType: one(leaveTypes, {
      fields: [leaveApprovalActions.fromLeaveTypeId],
      references: [leaveTypes.id],
      relationName: "fromLeaveType",
    }),
    toLeaveType: one(leaveTypes, {
      fields: [leaveApprovalActions.toLeaveTypeId],
      references: [leaveTypes.id],
      relationName: "toLeaveType",
    }),
  }),
);
export const overtimeRecordsRelations = relations(
  overtimeRecords,
  ({ one, many }) => ({
    employee: one(employees, {
      fields: [overtimeRecords.employeeId],
      references: [employees.id],
    }),
    workDayRecord: one(workDayRecords, {
      fields: [overtimeRecords.workDayRecordId],
      references: [workDayRecords.id],
    }),
    requestedBy: one(userAccounts, {
      fields: [overtimeRecords.requestedByUserAccountId],
      references: [userAccounts.id],
    }),
    approvalActions: many(overtimeApprovalActions),
  }),
);
export const overtimeApprovalActionsRelations = relations(
  overtimeApprovalActions,
  ({ one }) => ({
    overtimeRecord: one(overtimeRecords, {
      fields: [overtimeApprovalActions.overtimeRecordId],
      references: [overtimeRecords.id],
    }),
    actor: one(userAccounts, {
      fields: [overtimeApprovalActions.actorUserAccountId],
      references: [userAccounts.id],
    }),
  }),
);
export const advanceRequestsRelations = relations(
  advanceRequests,
  ({ one }) => ({
    employee: one(employees, {
      fields: [advanceRequests.employeeId],
      references: [employees.id],
    }),
    requestedBy: one(userAccounts, {
      fields: [advanceRequests.requestedByUserAccountId],
      references: [userAccounts.id],
      relationName: "advanceRequestedBy",
    }),
    decidedBy: one(userAccounts, {
      fields: [advanceRequests.decidedByUserAccountId],
      references: [userAccounts.id],
      relationName: "advanceDecidedBy",
    }),
  }),
);
export const loansRelations = relations(loans, ({ one, many }) => ({
  employee: one(employees, {
    fields: [loans.employeeId],
    references: [employees.id],
  }),
  approvedBy: one(userAccounts, {
    fields: [loans.approvedByUserAccountId],
    references: [userAccounts.id],
  }),
  installments: many(loanInstallments),
}));
export const loanInstallmentsRelations = relations(
  loanInstallments,
  ({ one }) => ({
    loan: one(loans, {
      fields: [loanInstallments.loanId],
      references: [loans.id],
    }),
    payrollRecord: one(payrollRecords, {
      fields: [loanInstallments.payrollRecordId],
      references: [payrollRecords.id],
    }),
  }),
);
export const debtTypesRelations = relations(debtTypes, ({ many }) => ({
  debtTransactions: many(debtTransactions),
}));
export const debtTransactionsRelations = relations(
  debtTransactions,
  ({ one, many }) => ({
    employee: one(employees, {
      fields: [debtTransactions.employeeId],
      references: [employees.id],
    }),
    debtType: one(debtTypes, {
      fields: [debtTransactions.debtTypeId],
      references: [debtTypes.id],
    }),
    originalTransaction: one(debtTransactions, {
      fields: [debtTransactions.originalTransactionId],
      references: [debtTransactions.id],
      relationName: "reversals",
    }),
    reversals: many(debtTransactions, { relationName: "reversals" }),
    recordedBy: one(userAccounts, {
      fields: [debtTransactions.recordedByUserAccountId],
      references: [userAccounts.id],
    }),
    settledInPayrollRecord: one(payrollRecords, {
      fields: [debtTransactions.settledInPayrollRecordId],
      references: [payrollRecords.id],
    }),
  }),
);
export const payrollConfigurationsRelations = relations(
  payrollConfigurations,
  ({ one, many }) => ({
    shop: one(shops, {
      fields: [payrollConfigurations.shopId],
      references: [shops.id],
    }),
    branch: one(branches, {
      fields: [payrollConfigurations.branchId],
      references: [branches.id],
    }),
    createdBy: one(userAccounts, {
      fields: [payrollConfigurations.createdByUserAccountId],
      references: [userAccounts.id],
    }),
    payrollItems: many(payrollItems),
  }),
);
export const payrollPeriodsRelations = relations(
  payrollPeriods,
  ({ one, many }) => ({
    shop: one(shops, {
      fields: [payrollPeriods.shopId],
      references: [shops.id],
    }),
    createdBy: one(userAccounts, {
      fields: [payrollPeriods.createdByUserAccountId],
      references: [userAccounts.id],
      relationName: "payrollPeriodCreatedBy",
    }),
    lockedBy: one(userAccounts, {
      fields: [payrollPeriods.lockedByUserAccountId],
      references: [userAccounts.id],
      relationName: "payrollPeriodLockedBy",
    }),
    payrollRecords: many(payrollRecords),
    appliedAdjustments: many(payrollAdjustments),
  }),
);
export const payrollRecordsRelations = relations(
  payrollRecords,
  ({ one, many }) => ({
    payrollPeriod: one(payrollPeriods, {
      fields: [payrollRecords.payrollPeriodId],
      references: [payrollPeriods.id],
    }),
    employee: one(employees, {
      fields: [payrollRecords.employeeId],
      references: [employees.id],
    }),
    employmentAssignment: one(employmentAssignments, {
      fields: [payrollRecords.employmentAssignmentId],
      references: [employmentAssignments.id],
    }),
    calculatedBy: one(userAccounts, {
      fields: [payrollRecords.calculatedByUserAccountId],
      references: [userAccounts.id],
    }),
    items: many(payrollItems),
    loanInstallments: many(loanInstallments),
    settledDebtTransactions: many(debtTransactions),
    adjustments: many(payrollAdjustments),
    payslip: one(payslips),
  }),
);
export const payrollItemsRelations = relations(payrollItems, ({ one }) => ({
  payrollRecord: one(payrollRecords, {
    fields: [payrollItems.payrollRecordId],
    references: [payrollRecords.id],
  }),
  payrollConfiguration: one(payrollConfigurations, {
    fields: [payrollItems.payrollConfigurationId],
    references: [payrollConfigurations.id],
  }),
  adjustment: one(payrollAdjustments),
}));
export const payrollAdjustmentsRelations = relations(
  payrollAdjustments,
  ({ one }) => ({
    originalPayrollRecord: one(payrollRecords, {
      fields: [payrollAdjustments.originalPayrollRecordId],
      references: [payrollRecords.id],
    }),
    appliedPayrollPeriod: one(payrollPeriods, {
      fields: [payrollAdjustments.appliedPayrollPeriodId],
      references: [payrollPeriods.id],
    }),
    requestedBy: one(userAccounts, {
      fields: [payrollAdjustments.requestedByUserAccountId],
      references: [userAccounts.id],
      relationName: "adjustmentRequestedBy",
    }),
    approvedBy: one(userAccounts, {
      fields: [payrollAdjustments.approvedByUserAccountId],
      references: [userAccounts.id],
      relationName: "adjustmentApprovedBy",
    }),
    appliedPayrollItem: one(payrollItems, {
      fields: [payrollAdjustments.appliedPayrollItemId],
      references: [payrollItems.id],
    }),
  }),
);
export const payslipsRelations = relations(payslips, ({ one, many }) => ({
  payrollRecord: one(payrollRecords, {
    fields: [payslips.payrollRecordId],
    references: [payrollRecords.id],
  }),
  generatedBy: one(userAccounts, {
    fields: [payslips.generatedByUserAccountId],
    references: [userAccounts.id],
    relationName: "payslipGeneratedBy",
  }),
  voidedBy: one(userAccounts, {
    fields: [payslips.voidedByUserAccountId],
    references: [userAccounts.id],
    relationName: "payslipVoidedBy",
  }),
  emailDeliveryLogs: many(emailDeliveryLogs),
}));
export const emailDeliveryLogsRelations = relations(
  emailDeliveryLogs,
  ({ one }) => ({
    payslip: one(payslips, {
      fields: [emailDeliveryLogs.payslipId],
      references: [payslips.id],
    }),
  }),
);
export const attachmentsRelations = relations(attachments, ({ one }) => ({
  employee: one(employees, {
    fields: [attachments.employeeId],
    references: [employees.id],
  }),
  leaveRequest: one(leaveRequests, {
    fields: [attachments.leaveRequestId],
    references: [leaveRequests.id],
  }),
  uploadedBy: one(userAccounts, {
    fields: [attachments.uploadedByUserAccountId],
    references: [userAccounts.id],
  }),
}));
export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actor: one(userAccounts, {
    fields: [auditLogs.actorUserAccountId],
    references: [userAccounts.id],
  }),
}));

export type Shop = typeof shops.$inferSelect;
export type NewShop = typeof shops.$inferInsert;
export type Employee = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;
export type PayrollRecord = typeof payrollRecords.$inferSelect;
export type NewPayrollRecord = typeof payrollRecords.$inferInsert;
