import { sql } from "drizzle-orm";
import {
  check,
  date,
  decimal,
  index,
  mysqlEnum,
  mysqlTable,
  smallint,
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
import { installmentStatusValues, loanStatusValues } from "../../db/schema.enums";
import { employees } from "../employee/employee.schema";
import { payrollRecords } from "../payroll/payroll.schema";
import { userAccounts } from "../user-account/user-account.schema";

export const loans = mysqlTable(
  "loans",
  {
    id: id(),
    employeeId: foreignId("employee_id")
      .notNull()
      .references(() => employees.id, restrict),
    principalAmount: decimal("principal_amount", {
      precision: 12,
      scale: 2,
    }).notNull(),
    reason: text("reason").notNull(),
    installmentCount: smallint("installment_count").notNull(),
    status: mysqlEnum("status", loanStatusValues).notNull().default("active"),
    approvedByUserAccountId: foreignId("approved_by_user_account_id")
      .notNull()
      .references(() => userAccounts.id, restrict),
    approvedAt: instant("approved_at").notNull(),
    closedAt: instant("closed_at"),
    ...timestamps,
  },
  (table) => [
    index("loans_employee_status_idx").on(table.employeeId, table.status),
    check(
      "chk_loan_principal_positive",
      sql`${table.principalAmount} > 0`,
    ),
    check(
      "chk_loan_installment_count",
      sql`${table.installmentCount} between 1 and 5`,
    ),
  ],
);

export const loanInstallments = mysqlTable(
  "loan_installments",
  {
    id: id(),
    loanId: foreignId("loan_id")
      .notNull()
      .references(() => loans.id, restrict),
    installmentNo: smallint("installment_no").notNull(),
    duePeriodStart: date("due_period_start").notNull(),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    status: mysqlEnum("status", installmentStatusValues)
      .notNull()
      .default("scheduled"),
    deductedAt: instant("deducted_at"),
    payrollRecordId: foreignId("payroll_record_id").references(
      () => payrollRecords.id,
      setNull,
    ),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("loan_installments_loan_no_uidx").on(
      table.loanId,
      table.installmentNo,
    ),
    index("loan_installments_due_status_idx").on(
      table.duePeriodStart,
      table.status,
    ),
    check(
      "chk_installment_no_positive",
      sql`${table.installmentNo} > 0`,
    ),
    check("chk_installment_amount_positive", sql`${table.amount} > 0`),
  ],
);

