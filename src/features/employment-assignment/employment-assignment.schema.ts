import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  decimal,
  index,
  mysqlEnum,
  mysqlTable,
  uniqueIndex,
} from "drizzle-orm/mysql-core";
import {
  foreignId,
  id,
  restrict,
  setNull,
  timestamps,
} from "../../db/schema.columns";
import { employmentTypeValues } from "../../db/schema.enums";
import { branches } from "../branch/branch.schema";
import { departments } from "../department/department.schema";
import { employees } from "../employee/employee.schema";
import { positions } from "../position/position.schema";
import { userAccounts } from "../user-account/user-account.schema";

export const employmentAssignments = mysqlTable(
  "employment_assignments",
  {
    id: id(),
    employeeId: foreignId("employee_id")
      .notNull()
      .references(() => employees.id, restrict),
    branchId: foreignId("branch_id")
      .notNull()
      .references(() => branches.id, restrict),
    departmentId: foreignId("department_id")
      .notNull()
      .references(() => departments.id, restrict),
    positionId: foreignId("position_id")
      .notNull()
      .references(() => positions.id, restrict),
    employmentType: mysqlEnum("employment_type", employmentTypeValues)
      .notNull()
      .default("full_time"),
    baseSalary: decimal("base_salary", { precision: 12, scale: 2 }).notNull(),
    welfareAmount: decimal("welfare_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    isPrimary: boolean("is_primary").notNull().default(true),
    createdByUserAccountId: foreignId("created_by_user_account_id").references(
      () => userAccounts.id,
      setNull,
    ),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("employment_assignments_employee_from_uidx").on(
      table.employeeId,
      table.effectiveFrom,
    ),
    index("employment_assignments_branch_department_idx").on(
      table.branchId,
      table.departmentId,
    ),
    index("employment_assignments_position_idx").on(table.positionId),
    check(
      "chk_assignment_salary_nonnegative",
      sql`${table.baseSalary} >= 0`,
    ),
    check(
      "chk_assignment_welfare_nonnegative",
      sql`${table.welfareAmount} >= 0`,
    ),
    check(
      "chk_assignment_period",
      sql`${table.effectiveTo} is null or ${table.effectiveTo} >= ${table.effectiveFrom}`,
    ),
  ],
);

