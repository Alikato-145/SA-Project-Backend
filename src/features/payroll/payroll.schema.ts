// Defines MySQL persistence for payroll configuration, periods, and results.
import { sql } from "drizzle-orm";
import {
  check,
  date,
  decimal,
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
  id,
  instant,
  restrict,
  setNull,
  timestamps,
} from "../../db/schema.columns";
import {
  payrollAdjustmentStatusValues,
  payrollItemDirectionValues,
  payrollItemTypeValues,
  payrollPeriodStatusValues,
  payrollRecordStatusValues,
} from "../../db/schema.enums";
import { branches } from "../branch/branch.schema";
import { employees } from "../employee/employee.schema";
import { employmentAssignments } from "../employment-assignment/employment-assignment.schema";
import { shops } from "../shop/shop.schema";
import { userAccounts } from "../user-account/user-account.schema";

export const payrollConfigurations = mysqlTable(
  "payroll_configurations",
  {
    id: id(),
    shopId: foreignId("shop_id")
      .notNull()
      .references(() => shops.id, restrict),
    branchId: foreignId("branch_id").references(() => branches.id, restrict),
    configKey: varchar("config_key", { length: 50 }).notNull(),
    numericValue: decimal("numeric_value", {
      precision: 14,
      scale: 4,
    }).notNull(),
    unit: varchar("unit", { length: 30 }).notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    createdByUserAccountId: foreignId("created_by_user_account_id").notNull(),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      name: "payroll_config_created_by_fk",
      columns: [table.createdByUserAccountId],
      foreignColumns: [userAccounts.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    uniqueIndex("payroll_configurations_scope_key_from_uidx").on(
      table.shopId,
      table.branchId,
      table.configKey,
      table.effectiveFrom,
    ),
    index("payroll_configurations_key_from_idx").on(
      table.configKey,
      table.effectiveFrom,
    ),
    check(
      "chk_config_value_nonnegative",
      sql`${table.numericValue} >= 0`,
    ),
    check(
      "chk_payroll_config_period",
      sql`${table.effectiveTo} is null or ${table.effectiveTo} >= ${table.effectiveFrom}`,
    ),
  ],
);

export const payrollPeriods = mysqlTable(
  "payroll_periods",
  {
    id: id(),
    shopId: foreignId("shop_id")
      .notNull()
      .references(() => shops.id, restrict),
    periodYear: smallint("period_year").notNull(),
    periodMonth: smallint("period_month").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    status: mysqlEnum("status", payrollPeriodStatusValues)
      .notNull()
      .default("draft"),
    createdByUserAccountId: foreignId("created_by_user_account_id")
      .notNull()
      .references(() => userAccounts.id, restrict),
    previewedAt: instant("previewed_at"),
    lockedByUserAccountId: foreignId("locked_by_user_account_id").references(
      () => userAccounts.id,
      setNull,
    ),
    lockedAt: instant("locked_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("payroll_periods_shop_year_month_uidx").on(
      table.shopId,
      table.periodYear,
      table.periodMonth,
    ),
    index("payroll_periods_status_idx").on(table.status),
    check(
      "chk_payroll_month",
      sql`${table.periodMonth} between 1 and 12`,
    ),
    check(
      "chk_payroll_period_dates",
      sql`${table.endDate} >= ${table.startDate}`,
    ),
  ],
);

export const payrollRecords = mysqlTable(
  "payroll_records",
  {
    id: id(),
    payrollPeriodId: foreignId("payroll_period_id")
      .notNull()
      .references(() => payrollPeriods.id, restrict),
    employeeId: foreignId("employee_id")
      .notNull()
      .references(() => employees.id, restrict),
    employmentAssignmentId: foreignId("employment_assignment_id").notNull(),
    status: mysqlEnum("status", payrollRecordStatusValues)
      .notNull()
      .default("draft"),
    baseSalarySnapshot: decimal("base_salary_snapshot", {
      precision: 12,
      scale: 2,
    }).notNull(),
    welfareSnapshot: decimal("welfare_snapshot", {
      precision: 12,
      scale: 2,
    })
      .notNull()
      .default(sql`0`),
    totalEarnings: decimal("total_earnings", { precision: 12, scale: 2 })
      .notNull()
      .default(sql`0`),
    totalDeductions: decimal("total_deductions", {
      precision: 12,
      scale: 2,
    })
      .notNull()
      .default(sql`0`),
    netPay: decimal("net_pay", { precision: 12, scale: 2 })
      .notNull()
      .default(sql`0`),
    calculatedAt: instant("calculated_at"),
    calculatedByUserAccountId: foreignId("calculated_by_user_account_id"),
    lockedAt: instant("locked_at"),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      name: "payroll_record_assignment_fk",
      columns: [table.employmentAssignmentId],
      foreignColumns: [employmentAssignments.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    foreignKey({
      name: "payroll_record_calculated_by_fk",
      columns: [table.calculatedByUserAccountId],
      foreignColumns: [userAccounts.id],
    })
      .onDelete("set null")
      .onUpdate("cascade"),
    uniqueIndex("payroll_records_period_employee_uidx").on(
      table.payrollPeriodId,
      table.employeeId,
    ),
    index("payroll_records_employee_idx").on(table.employeeId),
    check(
      "chk_payroll_base_salary",
      sql`${table.baseSalarySnapshot} >= 0`,
    ),
    check("chk_payroll_welfare", sql`${table.welfareSnapshot} >= 0`),
    check("chk_total_earnings", sql`${table.totalEarnings} >= 0`),
    check("chk_total_deductions", sql`${table.totalDeductions} >= 0`),
    check("chk_net_pay_nonnegative", sql`${table.netPay} >= 0`),
    check(
      "chk_payroll_totals",
      sql`${table.netPay} = ${table.totalEarnings} - ${table.totalDeductions}`,
    ),
  ],
);

export type PayrollRecord = typeof payrollRecords.$inferSelect;
export type NewPayrollRecord = typeof payrollRecords.$inferInsert;

export const payrollItems = mysqlTable(
  "payroll_items",
  {
    id: id(),
    payrollRecordId: foreignId("payroll_record_id")
      .notNull()
      .references(() => payrollRecords.id, restrict),
    itemType: mysqlEnum("item_type", payrollItemTypeValues).notNull(),
    direction: mysqlEnum("direction", payrollItemDirectionValues).notNull(),
    description: varchar("description", { length: 255 }).notNull(),
    quantity: decimal("quantity", { precision: 10, scale: 2 }),
    rate: decimal("rate", { precision: 14, scale: 4 }),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    payrollConfigurationId: foreignId("payroll_configuration_id"),
    sourceTable: varchar("source_table", { length: 80 }),
    sourceId: foreignId("source_id"),
    occurredOn: date("occurred_on"),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "payroll_item_config_fk",
      columns: [table.payrollConfigurationId],
      foreignColumns: [payrollConfigurations.id],
    })
      .onDelete("set null")
      .onUpdate("cascade"),
    index("payroll_items_record_direction_idx").on(
      table.payrollRecordId,
      table.direction,
    ),
    index("payroll_items_source_idx").on(table.sourceTable, table.sourceId),
    check("chk_payroll_item_amount", sql`${table.amount} >= 0`),
    check(
      "chk_payroll_item_quantity",
      sql`${table.quantity} is null or ${table.quantity} >= 0`,
    ),
    check(
      "chk_payroll_item_rate",
      sql`${table.rate} is null or ${table.rate} >= 0`,
    ),
    check(
      "chk_payroll_item_source_pair",
      sql`(${table.sourceTable} is null) = (${table.sourceId} is null)`,
    ),
  ],
);

export const payrollAdjustments = mysqlTable(
  "payroll_adjustments",
  {
    id: id(),
    originalPayrollRecordId: foreignId("original_payroll_record_id").notNull(),
    appliedPayrollPeriodId: foreignId("applied_payroll_period_id"),
    direction: mysqlEnum("direction", payrollItemDirectionValues).notNull(),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    reason: text("reason").notNull(),
    status: mysqlEnum("status", payrollAdjustmentStatusValues)
      .notNull()
      .default("pending"),
    requestedByUserAccountId: foreignId("requested_by_user_account_id").notNull(),
    requestedAt: instant("requested_at").notNull().defaultNow(),
    approvedByUserAccountId: foreignId("approved_by_user_account_id"),
    approvedAt: instant("approved_at"),
    appliedPayrollItemId: foreignId("applied_payroll_item_id")
      .unique()
      .references(() => payrollItems.id, setNull),
  },
  (table) => [
    foreignKey({
      name: "payroll_adj_original_record_fk",
      columns: [table.originalPayrollRecordId],
      foreignColumns: [payrollRecords.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    foreignKey({
      name: "payroll_adj_applied_period_fk",
      columns: [table.appliedPayrollPeriodId],
      foreignColumns: [payrollPeriods.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    foreignKey({
      name: "payroll_adj_requested_by_fk",
      columns: [table.requestedByUserAccountId],
      foreignColumns: [userAccounts.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    foreignKey({
      name: "payroll_adj_approved_by_fk",
      columns: [table.approvedByUserAccountId],
      foreignColumns: [userAccounts.id],
    })
      .onDelete("set null")
      .onUpdate("cascade"),
    index("payroll_adjustments_original_status_idx").on(
      table.originalPayrollRecordId,
      table.status,
    ),
    check("chk_adjustment_amount_positive", sql`${table.amount} > 0`),
  ],
);
