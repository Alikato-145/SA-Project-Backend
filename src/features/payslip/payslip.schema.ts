// Defines PostgreSQL persistence for payslips and email delivery attempts.
import {
  index,
  pgTable,
  text,
  varchar,
} from "drizzle-orm/pg-core";
import {
  foreignId,
  id,
  instant,
  restrict,
  setNull,
} from "../../db/schema.columns";
import {
  emailDeliveryStatusEnum,
  payslipStatusEnum,
} from "../../db/schema.enums";
import { payrollRecords } from "../payroll/payroll.schema";
import { userAccounts } from "../user-account/user-account.schema";

export const payslips = pgTable("payslips", {
  id: id(),
  payrollRecordId: foreignId("payroll_record_id")
    .notNull()
    .unique()
    .references(() => payrollRecords.id, restrict),
  fileStorageKey: text("file_storage_key").notNull(),
  fileSha256: varchar("file_sha256", { length: 64 }).notNull(),
  status: payslipStatusEnum("status")
    .notNull()
    .default("generated"),
  generatedAt: instant("generated_at").notNull().defaultNow(),
  generatedByUserAccountId: foreignId("generated_by_user_account_id").references(
    () => userAccounts.id,
    setNull,
  ),
  voidedAt: instant("voided_at"),
  voidedByUserAccountId: foreignId("voided_by_user_account_id").references(
    () => userAccounts.id,
    setNull,
  ),
});

export const emailDeliveryLogs = pgTable(
  "email_delivery_logs",
  {
    id: id(),
    payslipId: foreignId("payslip_id")
      .notNull()
      .references(() => payslips.id, restrict),
    recipientEmail: varchar("recipient_email", { length: 255 }).notNull(),
    status: emailDeliveryStatusEnum("status")
      .notNull()
      .default("pending"),
    providerMessageId: varchar("provider_message_id", { length: 255 }),
    attemptedAt: instant("attempted_at").notNull().defaultNow(),
    sentAt: instant("sent_at"),
    errorMessage: text("error_message"),
  },
  (table) => [
    index("email_delivery_logs_payslip_attempted_idx").on(
      table.payslipId,
      table.attemptedAt,
    ),
    index("email_delivery_logs_status_idx").on(table.status),
  ],
);
