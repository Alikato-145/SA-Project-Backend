import { boolean, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { id, timestamps } from "../../db/schema.columns";

export const shops = mysqlTable("shops", {
  id: id(),
  code: varchar("code", { length: 30 }).notNull().unique(),
  name: varchar("name", { length: 150 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});

export type Shop = typeof shops.$inferSelect;
export type NewShop = typeof shops.$inferInsert;
