import { index, json, mysqlTable, text, varchar } from "drizzle-orm/mysql-core";
import { foreignId, id, instant, setNull } from "../../db/schema.columns";
import { userAccounts } from "../user-account/user-account.schema";

export const auditLogs = mysqlTable(
  "audit_logs",
  {
    id: id(),
    actorUserAccountId: foreignId("actor_user_account_id").references(
      () => userAccounts.id,
      setNull,
    ),
    action: varchar("action", { length: 80 }).notNull(),
    tableName: varchar("table_name", { length: 100 }).notNull(),
    recordId: varchar("record_id", { length: 100 }).notNull(),
    oldData: json("old_data").$type<Record<string, unknown>>(),
    newData: json("new_data").$type<Record<string, unknown>>(),
    reason: text("reason"),
    occurredAt: instant("occurred_at").notNull().defaultNow(),
    requestId: varchar("request_id", { length: 100 }),
  },
  (table) => [
    index("audit_logs_target_occurred_idx").on(
      table.tableName,
      table.recordId,
      table.occurredAt,
    ),
    index("audit_logs_actor_occurred_idx").on(
      table.actorUserAccountId,
      table.occurredAt,
    ),
  ],
);

