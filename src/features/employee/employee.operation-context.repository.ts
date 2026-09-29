import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { operationExecutor } from "../../core/db/operation-context";
import { employmentAssignments } from "../employment-assignment/employment-assignment.schema";
import { branches } from "../branch/branch.schema";
import { employeeWeeklyHolidays } from "../employee-weekly-holiday/employee-weekly-holiday.schema";
export const employeeOperationContextRepository = {
 async datedAssignment(employeeId: number, date: string) {
  const [row] = await operationExecutor().select({ employeeId: employmentAssignments.employeeId, branchId: employmentAssignments.branchId, departmentId: employmentAssignments.departmentId, baseSalary: employmentAssignments.baseSalary, shopId: branches.shopId })
   .from(employmentAssignments).innerJoin(branches, eq(branches.id, employmentAssignments.branchId)).where(and(eq(employmentAssignments.employeeId,employeeId), lte(employmentAssignments.effectiveFrom,date), or(isNull(employmentAssignments.effectiveTo),gte(employmentAssignments.effectiveTo,date))));
  return row;
 },
 async branchShop(branchId: number) { return (await operationExecutor().query.branches.findFirst({ where: eq(branches.id,branchId) }))?.shopId; },
 async shopBranches(shopId: number) { return (await operationExecutor().select({id:branches.id}).from(branches).where(eq(branches.shopId,shopId))).map(row=>row.id); },
 async weeklyHoliday(employeeId: number, date: string) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return Boolean(await operationExecutor().query.employeeWeeklyHolidays.findFirst({where: and(eq(employeeWeeklyHolidays.employeeId,employeeId),eq(employeeWeeklyHolidays.weekday,weekday),lte(employeeWeeklyHolidays.effectiveFrom,date),or(isNull(employeeWeeklyHolidays.effectiveTo),gte(employeeWeeklyHolidays.effectiveTo,date)))}));
 },
};
