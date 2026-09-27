import { and, asc, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import type { DatabaseExecutor } from "../../core/db/transaction";
import { ApplicationError } from "../../core/errors/application.error";
import { employees } from "../employee/employee.schema";
import type { AssignmentCommand, EmploymentType } from "./employment-assignment.dto";
import { employmentAssignments } from "./employment-assignment.schema";

export interface AssignmentRecord { id: string; employeeId: string; branchId: string; departmentId: string; positionId: string; employmentType: EmploymentType; baseSalary: string; welfareAmount: string; effectiveFrom: string; effectiveTo: string | null; isPrimary: boolean; createdByUserAccountId: string | null }
export interface AssignmentRepositoryPort {
  employeeIsActive(executor: DatabaseExecutor, employeeId: string): Promise<boolean>;
  list(executor: DatabaseExecutor, employeeId: string): Promise<AssignmentRecord[]>;
  findLatest(executor: DatabaseExecutor, employeeId: string): Promise<AssignmentRecord | null>;
  findAtDate(executor: DatabaseExecutor, employeeId: string, date: string): Promise<AssignmentRecord | null>;
  close(executor: DatabaseExecutor, assignmentId: string, effectiveTo: string): Promise<AssignmentRecord | null>;
  insert(executor: DatabaseExecutor, employeeId: string, actorAccountId: string, input: AssignmentCommand): Promise<AssignmentRecord>;
}
const id = (value: string): number => { const parsed=Number(value); if (!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(parsed)) throw new RangeError("Invalid ID"); return parsed; };
const project=(row: typeof employmentAssignments.$inferSelect): AssignmentRecord => ({ id:String(row.id), employeeId:String(row.employeeId), branchId:String(row.branchId), departmentId:String(row.departmentId), positionId:String(row.positionId), employmentType:row.employmentType, baseSalary:row.baseSalary, welfareAmount:row.welfareAmount, effectiveFrom:row.effectiveFrom, effectiveTo:row.effectiveTo, isPrimary:row.isPrimary, createdByUserAccountId:row.createdByUserAccountId===null?null:String(row.createdByUserAccountId) });
const writeError=(error: unknown): never => { const code=(error as {code?:unknown})?.code; if(code==="23P01"||code==="23505") throw new ApplicationError("EFFECTIVE_DATE_OVERLAP",{cause:error}); throw error; };
export const employmentAssignmentRepository: AssignmentRepositoryPort = {
  async employeeIsActive(executor, employeeId) { const [row]=await executor.select({id:employees.id}).from(employees).where(and(eq(employees.id,id(employeeId)),eq(employees.status,"active"))).limit(1); return row!==undefined; },
  async list(executor, employeeId) { const rows=await executor.select().from(employmentAssignments).where(eq(employmentAssignments.employeeId,id(employeeId))).orderBy(asc(employmentAssignments.effectiveFrom),asc(employmentAssignments.id)); return rows.map(project); },
  async findLatest(executor, employeeId) { const [row]=await executor.select().from(employmentAssignments).where(eq(employmentAssignments.employeeId,id(employeeId))).orderBy(desc(employmentAssignments.effectiveFrom),desc(employmentAssignments.id)).limit(1).for("update"); return row?project(row):null; },
  async findAtDate(executor, employeeId, date) { const [row]=await executor.select().from(employmentAssignments).where(and(eq(employmentAssignments.employeeId,id(employeeId)),lte(employmentAssignments.effectiveFrom,date),or(isNull(employmentAssignments.effectiveTo),gte(employmentAssignments.effectiveTo,date)))).orderBy(desc(employmentAssignments.effectiveFrom)).limit(1); return row?project(row):null; },
  async close(executor, assignmentId, effectiveTo) { const [row]=await executor.update(employmentAssignments).set({effectiveTo,updatedAt:new Date()}).where(and(eq(employmentAssignments.id,id(assignmentId)),isNull(employmentAssignments.effectiveTo))).returning(); return row?project(row):null; },
  async insert(executor, employeeId, actorAccountId, input) { try { const [row]=await executor.insert(employmentAssignments).values({employeeId:id(employeeId),branchId:id(input.branchId),departmentId:id(input.departmentId),positionId:id(input.positionId),employmentType:input.employmentType,baseSalary:input.baseSalary,welfareAmount:input.welfareAmount,effectiveFrom:input.effectiveFrom,effectiveTo:input.effectiveTo,isPrimary:true,createdByUserAccountId:id(actorAccountId)}).returning(); if(!row)throw new Error("Assignment insert returned no row"); return project(row); } catch(error){return writeError(error);} },
};
