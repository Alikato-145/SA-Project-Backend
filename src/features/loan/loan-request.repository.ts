import { and, desc, eq } from "drizzle-orm";
import { operationExecutor, operationTransaction } from "../../core/db/operation-context";
import { loanRequests } from "./loan.schema";
import type { LoanRequest, RequestLoanCommand } from "./loan.dto";
export type LoanRequestDecision = Pick<LoanRequest, "status" | "decidedByUserAccountId" | "decidedAt" | "decisionNote" | "loanId">;
export class DrizzleLoanRequestRepository {
 withTransaction<T>(work:()=>Promise<T>) { return operationTransaction(work); }
 async insert(command: RequestLoanCommand & {requestedByUserAccountId:number}):Promise<LoanRequest> {
  const [row]=await operationExecutor().insert(loanRequests).values(command).returning(); return row;
 }
 listByEmployee(employeeId:number):Promise<LoanRequest[]> { return operationExecutor().select().from(loanRequests).where(eq(loanRequests.employeeId,employeeId)).orderBy(desc(loanRequests.id)); }
 async findForUpdate(id:number):Promise<LoanRequest|undefined> { const [row]=await operationExecutor().select().from(loanRequests).where(eq(loanRequests.id,id)).for("update"); return row; }
 async decide(id:number, decision:LoanRequestDecision):Promise<LoanRequest> { const [row]=await operationExecutor().update(loanRequests).set(decision).where(and(eq(loanRequests.id,id),eq(loanRequests.status,"pending"))).returning(); return row; }
}
export type LoanRequestRepository = Pick<DrizzleLoanRequestRepository,keyof DrizzleLoanRequestRepository>;
