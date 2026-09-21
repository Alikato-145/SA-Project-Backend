// Defines PostgreSQL persistence for restaurant branches.
import {
  boolean,
  index,
  pgTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { foreignId, id, restrict, timestamps } from "../../db/schema.columns";
import { shops } from "../shop/shop.schema";

export const branches = pgTable(
  "branches",
  {
    id: id(),
    shopId: foreignId("shop_id")
      .notNull()
      .references(() => shops.id, restrict),
    code: varchar("code", { length: 30 }).notNull(),
    name: varchar("name", { length: 150 }).notNull(),
    address: text("address"),
    timezone: varchar("timezone", { length: 50 })
      .notNull()
      .default("Asia/Bangkok"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("branches_shop_code_uidx").on(table.shopId, table.code),
    index("branches_shop_idx").on(table.shopId),
  ],
);
