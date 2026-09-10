// Defines MySQL persistence for access-control roles and their scopes.
import { boolean, mysqlEnum, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { smallId } from "../../db/schema.columns";
import { roleScopeValues } from "../../db/schema.enums";

export const roles = mysqlTable("roles", {
  id: smallId(),
  code: varchar("code", { length: 30 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  scope: mysqlEnum("scope", roleScopeValues).notNull(),
  isActive: boolean("is_active").notNull().default(true),
});
