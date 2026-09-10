import { sql } from "drizzle-orm";
import {
  check,
  date,
  mysqlTable,
  smallint,
  uniqueIndex,
} from "drizzle-orm/mysql-core";
import { foreignId, id, restrict, timestamps } from "../../db/schema.columns";
import { employees } from "../employee/employee.schema";

export const employeeWeeklyHolidays = mysqlTable(
  "employee_weekly_holidays",
  {
    id: id(),
    employeeId: foreignId("employee_id")
      .notNull()
      .references(() => employees.id, restrict),
    weekday: smallint("weekday").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("employee_weekly_holidays_uidx").on(
      table.employeeId,
      table.weekday,
      table.effectiveFrom,
    ),
    check("chk_weekday_range", sql`${table.weekday} between 0 and 6`),
    check(
      "chk_weekly_holiday_period",
      sql`${table.effectiveTo} is null or ${table.effectiveTo} >= ${table.effectiveFrom}`,
    ),
  ],
);

