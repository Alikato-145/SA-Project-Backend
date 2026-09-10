import {
  boolean,
  index,
  mysqlTable,
  text,
  varchar,
} from "drizzle-orm/mysql-core";
import { foreignId, id, restrict, timestamps } from "../../db/schema.columns";
import { employees } from "../employee/employee.schema";

export const employeeBankAccounts = mysqlTable(
  "employee_bank_accounts",
  {
    id: id(),
    employeeId: foreignId("employee_id")
      .notNull()
      .references(() => employees.id, restrict),
    bankCode: varchar("bank_code", { length: 20 }).notNull(),
    bankName: varchar("bank_name", { length: 100 }).notNull(),
    accountHolderName: varchar("account_holder_name", { length: 200 }).notNull(),
    accountNumberCiphertext: text("account_number_ciphertext").notNull(),
    accountNumberLast4: varchar("account_number_last4", { length: 4 }).notNull(),
    isPrimary: boolean("is_primary").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (table) => [index("employee_bank_accounts_employee_idx").on(table.employeeId)],
);

