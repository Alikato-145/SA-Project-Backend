import { and, asc, count, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { DatabaseExecutor } from "../../core/db/transaction";
import { employmentAssignments } from "../employment-assignment/employment-assignment.schema";
import type { EmployeeListFilters, EmployeeStatus } from "./employee.dto";
import { employees } from "./employee.schema";
import type { EmployeeVisibility } from "./employee.scope";
import { parseEmployeeId } from "./employee.validation";

export interface EmployeeReadRecord {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  nationalId: string | null;
  passportId: string | null;
  phone: string | null;
  personalEmail: string | null;
  address: string | null;
  hireDate: string;
  status: EmployeeStatus;
  terminatedAt: string | null;
  currentAssignment: { branchId: string; departmentId: string; positionId: string } | null;
}

export interface EmployeeReadPage {
  items: EmployeeReadRecord[];
  page: number;
  pageSize: number;
  total: number;
}

export interface EmployeeRepositoryPort {
  list(executor: DatabaseExecutor, query: EmployeeListFilters, visibility: EmployeeVisibility, today: string): Promise<EmployeeReadPage>;
  findById(executor: DatabaseExecutor, employeeId: string, visibility: EmployeeVisibility, today: string): Promise<EmployeeReadRecord | null>;
}

const numberId = (value: string): number => parseEmployeeId(value, "id");
const currentAssignmentJoin = (today: string) => and(
  eq(employmentAssignments.employeeId, employees.id),
  lte(employmentAssignments.effectiveFrom, today),
  or(sql`${employmentAssignments.effectiveTo} is null`, gte(employmentAssignments.effectiveTo, today)),
);
const visibilityWhere = (visibility: EmployeeVisibility): SQL | undefined => {
  if (visibility.all) return undefined;
  const grants: SQL[] = [];
  if (visibility.selfEmployeeId) grants.push(eq(employees.id, numberId(visibility.selfEmployeeId)));
  for (const branchId of visibility.branchIds) grants.push(eq(employmentAssignments.branchId, numberId(branchId)));
  for (const department of visibility.departments) grants.push(and(
    eq(employmentAssignments.branchId, numberId(department.branchId)),
    eq(employmentAssignments.departmentId, numberId(department.departmentId)),
  )!);
  return grants.length ? or(...grants) : sql`false`;
};
const selection = {
  id: employees.id,
  employeeCode: employees.employeeCode,
  firstName: employees.firstName,
  lastName: employees.lastName,
  nationalId: employees.nationalId,
  passportId: employees.passportId,
  phone: employees.phone,
  personalEmail: employees.personalEmail,
  address: employees.address,
  hireDate: employees.hireDate,
  status: employees.status,
  terminatedAt: employees.terminatedAt,
  branchId: employmentAssignments.branchId,
  departmentId: employmentAssignments.departmentId,
  positionId: employmentAssignments.positionId,
};
const project = (row: {
  id: number; employeeCode: string; firstName: string; lastName: string;
  nationalId: string | null; passportId: string | null; phone: string | null;
  personalEmail: string | null; address: string | null; hireDate: string;
  status: EmployeeStatus; terminatedAt: string | null;
  branchId: number | null; departmentId: number | null; positionId: number | null;
}): EmployeeReadRecord => ({
  id: String(row.id), employeeCode: row.employeeCode, firstName: row.firstName, lastName: row.lastName,
  nationalId: row.nationalId, passportId: row.passportId, phone: row.phone,
  personalEmail: row.personalEmail, address: row.address, hireDate: row.hireDate,
  status: row.status, terminatedAt: row.terminatedAt,
  currentAssignment: row.branchId === null || row.departmentId === null || row.positionId === null
    ? null : { branchId: String(row.branchId), departmentId: String(row.departmentId), positionId: String(row.positionId) },
});

export const employeeRepository: EmployeeRepositoryPort = {
  async list(executor, query, visibility, today) {
    const conditions: SQL[] = [];
    const scoped = visibilityWhere(visibility);
    if (scoped) conditions.push(scoped);
    if (query.status) conditions.push(eq(employees.status, query.status));
    if (query.branchId) conditions.push(eq(employmentAssignments.branchId, numberId(query.branchId)));
    if (query.departmentId) conditions.push(eq(employmentAssignments.departmentId, numberId(query.departmentId)));
    if (query.search) {
      const escaped = query.search.replace(/[\\%_]/g, "\\$&");
      const pattern = `%${escaped}%`;
      conditions.push(or(
        ilike(employees.employeeCode, pattern),
        ilike(employees.firstName, pattern),
        ilike(employees.lastName, pattern),
      )!);
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const offset = (query.page - 1) * query.pageSize;
    const rows = await executor.select(selection).from(employees)
      .leftJoin(employmentAssignments, currentAssignmentJoin(today)).where(where)
      .orderBy(asc(employees.employeeCode), asc(employees.id)).limit(query.pageSize).offset(offset);
    const [totalRow] = await executor.select({ value: count() }).from(employees)
      .leftJoin(employmentAssignments, currentAssignmentJoin(today)).where(where);
    return { items: rows.map(project), page: query.page, pageSize: query.pageSize, total: Number(totalRow?.value ?? 0) };
  },
  async findById(executor, employeeId, visibility, today) {
    const scoped = visibilityWhere(visibility);
    const where = and(eq(employees.id, numberId(employeeId)), scoped);
    const [row] = await executor.select(selection).from(employees)
      .leftJoin(employmentAssignments, currentAssignmentJoin(today)).where(where).limit(1);
    return row ? project(row) : null;
  },
};
