// Defines PostgreSQL persistence for employee loans and repayment installments.
import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  numeric,
  pgTable,
  smallint,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import {
  foreignId,
  id,
  instant,
  restrict,
  setNull,
  timestamps,
} from "../../db/schema.columns";
import { installmentStatusEnum, loanStatusEnum, loanRequestStatusEnum } from "../../db/schema.enums";
import { employees } from "../employee/employee.schema";
import { payrollRecords } from "../payroll/payroll.schema";
import { userAccounts } from "../user-account/user-account.schema";

export const loans = pgTable(
  "loans",
  {
    id: id(),
    employeeId: foreignId("employee_id")
      .notNull()
      .references(() => employees.id, restrict),
    principalAmount: numeric("principal_amount", {
      precision: 12,
      scale: 2,
    }).notNull(),
    reason: text("reason").notNull(),
    installmentCount: smallint("installment_count").notNull(),
    status: loanStatusEnum("status").notNull().default("active"),
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

export const loanInstallments = pgTable(
  "loan_installments",
  {
    id: id(),
    loanId: foreignId("loan_id")
      .notNull()
      .references(() => loans.id, restrict),
    installmentNo: smallint("installment_no").notNull(),
    duePeriodStart: date("due_period_start").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    status: installmentStatusEnum("status")
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

export const loanRequests = pgTable("loan_requests", {
  id: id(),
  employeeId: foreignId("employee_id").notNull().references(() => employees.id, restrict),
  principalAmount: numeric("principal_amount", { precision: 12, scale: 2 }).notNull(),
  installmentCount: smallint("installment_count").notNull(),
  reason: text("reason").notNull(),
  status: loanRequestStatusEnum("status").notNull().default("pending"),
  requestedByUserAccountId: foreignId("requested_by_user_account_id").notNull().references(() => userAccounts.id, restrict),
  requestedAt: instant("requested_at").notNull().defaultNow(),
  decidedByUserAccountId: foreignId("decided_by_user_account_id").references(() => userAccounts.id, restrict),
  decidedAt: instant("decided_at"),
  decisionNote: text("decision_note"),
  loanId: foreignId("loan_id").references(() => loans.id, restrict),
}, (table) => [
  index("loan_requests_employee_status_idx").on(table.employeeId, table.status),
  uniqueIndex("loan_requests_loan_uidx").on(table.loanId),
  check("chk_loan_request_principal_positive", sql`${table.principalAmount} > 0`),
  check("chk_loan_request_installment_count", sql`${table.installmentCount} between 1 and 5`),
  check("chk_loan_request_reason", sql`length(trim(${table.reason})) > 0`),
  check("chk_loan_request_decision", sql`(
    (${table.status} = 'pending' and ${table.decidedByUserAccountId} is null and ${table.decidedAt} is null and ${table.decisionNote} is null and ${table.loanId} is null)
    or (${table.status} = 'approved' and ${table.decidedByUserAccountId} is not null and ${table.decidedAt} is not null and ${table.loanId} is not null)
    or (${table.status} = 'rejected' and ${table.decidedByUserAccountId} is not null and ${table.decidedAt} is not null and ${table.loanId} is null and length(trim(${table.decisionNote})) > 0 and ${table.decisionNote} is not null)
  )`),
]);
