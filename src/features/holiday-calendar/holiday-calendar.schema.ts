import {
  boolean,
  date,
  mysqlTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import {
  foreignId,
  id,
  restrict,
  setNull,
  timestamps,
} from "../../db/schema.columns";
import { shops } from "../shop/shop.schema";
import { userAccounts } from "../user-account/user-account.schema";

export const holidayCalendars = mysqlTable(
  "holiday_calendars",
  {
    id: id(),
    shopId: foreignId("shop_id")
      .notNull()
      .references(() => shops.id, restrict),
    holidayDate: date("holiday_date").notNull(),
    name: varchar("name", { length: 150 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdByUserAccountId: foreignId("created_by_user_account_id").references(
      () => userAccounts.id,
      setNull,
    ),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("holiday_calendars_shop_date_uidx").on(
      table.shopId,
      table.holidayDate,
    ),
  ],
);

