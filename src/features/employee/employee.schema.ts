// Defines MySQL persistence for employee identity and employment status.
import { sql } from "drizzle-orm";
import {
  check,
  date,
  mysqlEnum,
  mysqlTable,
  text,
  varchar,
} from "drizzle-orm/mysql-core";
import { id, timestamps } from "../../db/schema.columns";
import { employeeStatusValues } from "../../db/schema.enums";

export const employees = mysqlTable(
  "employees",
  {
    id: id(),
    employeeCode: varchar("employee_code", { length: 30 }).notNull().unique(),
    nationalId: varchar("national_id", { length: 20 }).unique(),
    passportId: varchar("passport_id", { length: 30 }).unique(),
    firstName: varchar("first_name", { length: 100 }).notNull(),
    lastName: varchar("last_name", { length: 100 }).notNull(),
    phone: varchar("phone", { length: 30 }),
    personalEmail: varchar("personal_email", { length: 255 }),
    address: text("address"),
    hireDate: date("hire_date").notNull(),
    status: mysqlEnum("status", employeeStatusValues)
      .notNull()
      .default("active"),
    terminatedAt: date("terminated_at"),
    ...timestamps,
  },
  (table) => [
    check(
      "chk_employee_identity",
      sql`${table.nationalId} is not null or ${table.passportId} is not null`,
    ),
    check(
      "chk_employee_dates",
      sql`${table.terminatedAt} is null or ${table.terminatedAt} >= ${table.hireDate}`,
    ),
  ],
);

export type Employee = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;
