import {
  boolean,
  mysqlTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { foreignId, id, restrict, timestamps } from "../../db/schema.columns";
import { shops } from "../shop/shop.schema";

export const positions = mysqlTable(
  "positions",
  {
    id: id(),
    shopId: foreignId("shop_id")
      .notNull()
      .references(() => shops.id, restrict),
    code: varchar("code", { length: 30 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("positions_shop_code_uidx").on(table.shopId, table.code),
  ],
);

