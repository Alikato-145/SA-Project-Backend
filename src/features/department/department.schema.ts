import {
  boolean,
  index,
  mysqlTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { foreignId, id, restrict, timestamps } from "../../db/schema.columns";
import { branches } from "../branch/branch.schema";

export const departments = mysqlTable(
  "departments",
  {
    id: id(),
    branchId: foreignId("branch_id")
      .notNull()
      .references(() => branches.id, restrict),
    code: varchar("code", { length: 30 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("departments_branch_code_uidx").on(table.branchId, table.code),
    index("departments_branch_idx").on(table.branchId),
  ],
);

