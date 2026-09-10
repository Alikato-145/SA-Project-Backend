import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  mysqlTable,
  varchar,
  text,
} from "drizzle-orm/mysql-core";
import { foreignId, id, instant, restrict } from "../../db/schema.columns";
import { employees } from "../employee/employee.schema";
import { leaveRequests } from "../leave/leave.schema";
import { userAccounts } from "../user-account/user-account.schema";

export const attachments = mysqlTable(
  "attachments",
  {
    id: id(),
    employeeId: foreignId("employee_id").references(() => employees.id, restrict),
    leaveRequestId: foreignId("leave_request_id").references(
      () => leaveRequests.id,
      restrict,
    ),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: varchar("mime_type", { length: 100 }).notNull(),
    fileSizeBytes: bigint("file_size_bytes", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    fileSha256: varchar("file_sha256", { length: 64 }).notNull(),
    uploadedByUserAccountId: foreignId("uploaded_by_user_account_id")
      .notNull()
      .references(() => userAccounts.id, restrict),
    uploadedAt: instant("uploaded_at").notNull().defaultNow(),
  },
  (table) => [
    index("attachments_employee_idx").on(table.employeeId),
    index("attachments_leave_request_idx").on(table.leaveRequestId),
    check(
      "chk_attachment_single_owner",
      sql`(${table.employeeId} is not null and ${table.leaveRequestId} is null) or (${table.employeeId} is null and ${table.leaveRequestId} is not null)`,
    ),
    check("chk_attachment_size_positive", sql`${table.fileSizeBytes} > 0`),
  ],
);

