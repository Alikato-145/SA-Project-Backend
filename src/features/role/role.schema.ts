// Defines PostgreSQL persistence for access-control roles and their scopes.
import { boolean, pgTable, varchar } from "drizzle-orm/pg-core";
import { smallId } from "../../db/schema.columns";
import { roleScopeEnum } from "../../db/schema.enums";

export const roles = pgTable("roles", {
  id: smallId(),
  code: varchar("code", { length: 30 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  scope: roleScopeEnum("scope").notNull(),
  isActive: boolean("is_active").notNull().default(true),
});
