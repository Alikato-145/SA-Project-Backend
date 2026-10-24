import { bangkokToday, realDate } from "../../shared/operation-validation";
import type { LoanActor, RequestLoanCommand } from "./loan.dto";
import type { LoanService } from "./loan.service";
import { splitInstallments } from "./loan.service";
import type { LoanRequestRepository } from "./loan-request.repository";
import { ApplicationError } from "../../core/errors/application.error";
export type LoanRequestAccess = {
 assertOwnOrFinance(actor:LoanActor,employeeId:number):Promise<void>;
 assertFinance(actor:LoanActor):Promise<void>;
};
export class LoanRequestService {
 constructor(private readonly repository:LoanRequestRepository,private readonly loans:Pick<LoanService,"createLoan">,private readonly access:LoanRequestAccess) {}
 async createRequest(actor:LoanActor,command:RequestLoanCommand) {
  await this.access.assertOwnOrFinance(actor,command.employeeId);
  splitInstallments(command.principalAmount,command.installmentCount);
  if(!command.reason.trim())throw new ApplicationError("VALIDATION_ERROR");
  return this.repository.insert({...command,requestedByUserAccountId:actor.accountId});
 }
 async listRequests(actor:LoanActor,employeeId:number) { await this.access.assertOwnOrFinance(actor,employeeId);return this.repository.listByEmployee(employeeId); }
 private async pending(id:number) { const row=await this.repository.findForUpdate(id);if(!row)throw new ApplicationError("LOAN_REQUEST_NOT_FOUND");if(row.status!=="pending")throw new ApplicationError("LOAN_REQUEST_NOT_PENDING");return row; }
 async approveRequest(actor:LoanActor,id:number,firstDueMonth:string) {
  await this.access.assertFinance(actor);
  return this.repository.withTransaction(async()=>{
   const row=await this.pending(id);
   realDate(firstDueMonth);if(!firstDueMonth.endsWith("-01"))throw new ApplicationError("LOAN_INVALID_INSTALLMENTS");
   if(firstDueMonth < `${bangkokToday().slice(0,7)}-01`)throw new ApplicationError("LOAN_REQUEST_PAST_DUE_MONTH");
   const created=await this.loans.createLoan(actor,{employeeId:row.employeeId,principalAmount:row.principalAmount,installmentCount:row.installmentCount,reason:row.reason,firstDueMonth});
   return this.repository.decide(id,{status:"approved",loanId:created.loan.id,decidedByUserAccountId:actor.accountId,decidedAt:new Date(),decisionNote:null});
  });
 }
 async rejectRequest(actor:LoanActor,id:number,decisionNote:string) {
  await this.access.assertFinance(actor);if(!decisionNote.trim())throw new ApplicationError("VALIDATION_ERROR");
  return this.repository.withTransaction(async()=>{await this.pending(id);return this.repository.decide(id,{status:"rejected",loanId:null,decidedByUserAccountId:actor.accountId,decidedAt:new Date(),decisionNote:decisionNote.trim()});});
 }
}
