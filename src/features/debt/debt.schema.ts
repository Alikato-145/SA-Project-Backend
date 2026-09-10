import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  decimal,
  index,
  mysqlEnum,
  mysqlTable,
  text,
  varchar,
  type AnyMySqlColumn,
} from "drizzle-orm/mysql-core";
import {
  foreignId,
  foreignSmallId,
  id,
  instant,
  restrict,
  setNull,
  smallId,
  timestamps,
} from "../../db/schema.columns";
import { debtTransactionKindValues } from "../../db/schema.enums";
import { employees } from "../employee/employee.schema";
import { payrollRecords } from "../payroll/payroll.schema";
import { userAccounts } from "../user-account/user-account.schema";

export const debtTypes = mysqlTable("debt_types", {
  id: smallId(),
  code: varchar("code", { length: 30 }).notNull().unique(),
  nameTh: varchar("name_th", { length: 100 }).notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});

export const debtTransactions = mysqlTable(
  "debt_transactions",
  {
    id: id(),
    employeeId: foreignId("employee_id")
      .notNull()
      .references(() => employees.id, restrict),
    debtTypeId: foreignSmallId("debt_type_id")
      .notNull()
      .references(() => debtTypes.id, restrict),
    transactionKind: mysqlEnum(
      "transaction_kind",
      debtTransactionKindValues,
    )
      .notNull()
      .default("charge"),
    transactionDate: date("transaction_date").notNull(),
    description: text("description").notNull(),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    originalTransactionId: foreignId("original_transaction_id").references(
      (): AnyMySqlColumn => debtTransactions.id,
      restrict,
    ),
    recordedByUserAccountId: foreignId("recorded_by_user_account_id")
      .notNull()
      .references(() => userAccounts.id, restrict),
    settledInPayrollRecordId: foreignId(
      "settled_in_payroll_record_id",
    ).references(() => payrollRecords.id, setNull),
    settledAt: instant("settled_at"),
    ...timestamps,
  },
  (table) => [
    index("debt_transactions_employee_date_idx").on(
      table.employeeId,
      table.transactionDate,
    ),
    index("debt_transactions_employee_settled_idx").on(
      table.employeeId,
      table.settledAt,
    ),
    index("debt_transactions_type_idx").on(table.debtTypeId),
    check("chk_debt_amount_positive", sql`${table.amount} > 0`),
  ],
);
