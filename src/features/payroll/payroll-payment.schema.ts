import { sql } from "drizzle-orm";
import { check, index, numeric, pgTable, text, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { foreignId, id, instant, restrict, timestamps } from "../../db/schema.columns";
import { paymentMethodEnum, payrollPaymentStatusEnum } from "../../db/schema.enums";
import { branches } from "../branch/branch.schema";
import { employeeBankAccounts } from "../employee-bank-account/employee-bank-account.schema";
import { userAccounts } from "../user-account/user-account.schema";
import { payrollRecords } from "./payroll.schema";
export const payrollPayments = pgTable("payroll_payments", {
  id: id(),
  payrollRecordId: foreignId("payroll_record_id").notNull().references(() => payrollRecords.id, restrict),
  branchIdSnapshot: foreignId("branch_id_snapshot").notNull().references(() => branches.id, restrict),
  paymentMethod: paymentMethodEnum("payment_method").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  status: payrollPaymentStatusEnum("status").notNull().default("prepared"),
  employeeBankAccountId: foreignId("employee_bank_account_id").references(() => employeeBankAccounts.id, restrict),
  promptpayPhoneSnapshot: varchar("promptpay_phone_snapshot", { length: 10 }),
  bankCodeSnapshot: varchar("bank_code_snapshot", { length: 20 }),
  accountHolderNameSnapshot: varchar("account_holder_name_snapshot", { length: 200 }),
  accountNumberCiphertextSnapshot: text("account_number_ciphertext_snapshot"),
  accountNumberLast4Snapshot: varchar("account_number_last4_snapshot", { length: 4 }),
  preparedByUserAccountId: foreignId("prepared_by_user_account_id").notNull().references(() => userAccounts.id, restrict),
  preparedAt: instant("prepared_at").notNull().defaultNow(),
  paidByUserAccountId: foreignId("paid_by_user_account_id").references(() => userAccounts.id, restrict),
  paidAt: instant("paid_at"),
  referenceNo: varchar("reference_no", { length: 200 }),
  cancelledByUserAccountId: foreignId("cancelled_by_user_account_id").references(() => userAccounts.id, restrict),
  cancelledAt: instant("cancelled_at"),
  cancellationReason: text("cancellation_reason"),
  ...timestamps,
}, t => [
  uniqueIndex("payroll_payments_active_record_uidx").on(t.payrollRecordId).where(sql `${t.status} in ('prepared','paid')`),
  index("payroll_payments_branch_status_idx").on(t.branchIdSnapshot, t.status),
  check("chk_payment_positive", sql `${t.amount} > 0`),
  check("chk_payment_phone", sql `${t.promptpayPhoneSnapshot} is null or ${t.promptpayPhoneSnapshot} ~ '^0[689][0-9]{8}$'`),
  check("chk_payment_bank_tuple", sql `(${t.employeeBankAccountId} is null and ${t.bankCodeSnapshot} is null and ${t.accountHolderNameSnapshot} is null and ${t.accountNumberCiphertextSnapshot} is null and ${t.accountNumberLast4Snapshot} is null) or (${t.employeeBankAccountId} is not null and ${t.bankCodeSnapshot} is not null and ${t.accountHolderNameSnapshot} is not null and ${t.accountNumberCiphertextSnapshot} is not null and ${t.accountNumberLast4Snapshot} is not null and length(trim(${t.bankCodeSnapshot})) > 0 and length(trim(${t.accountHolderNameSnapshot})) > 0 and length(${t.accountNumberCiphertextSnapshot}) > 0 and ${t.accountNumberLast4Snapshot} ~ '^[0-9]{4}$')`),
  check("chk_payment_destination", sql `(${t.paymentMethod} = 'cash' and ${t.employeeBankAccountId} is null and ${t.promptpayPhoneSnapshot} is null) or (${t.paymentMethod} = 'transfer' and (${t.promptpayPhoneSnapshot} is not null or ${t.employeeBankAccountId} is not null))`),
  check("chk_payment_lifecycle", sql `(${t.status} = 'prepared' and ${t.paidByUserAccountId} is null and ${t.paidAt} is null and ${t.referenceNo} is null and ${t.cancelledByUserAccountId} is null and ${t.cancelledAt} is null and ${t.cancellationReason} is null) or (${t.status} = 'paid' and ${t.paidByUserAccountId} is not null and ${t.paidAt} is not null and ${t.cancelledByUserAccountId} is null and ${t.cancelledAt} is null and ${t.cancellationReason} is null) or (${t.status} = 'cancelled' and ${t.cancelledByUserAccountId} is not null and ${t.cancelledAt} is not null and ${t.cancellationReason} is not null and length(trim(${t.cancellationReason})) > 0 and ${t.paidByUserAccountId} is null and ${t.paidAt} is null and ${t.referenceNo} is null)`),
]);
