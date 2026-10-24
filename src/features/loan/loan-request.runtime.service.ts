import type { OperationRuntime } from "../../core/db/operation-runtime";
import { runOperation } from "../../core/db/operation-runtime";
import { bangkokToday } from "../../shared/operation-validation";
import type { LoanService } from "./loan.service";
import { LoanRequestService } from "./loan-request.service";
import { DrizzleLoanRequestRepository } from "./loan-request.repository";
export const createLoanRequestRuntimeService=(runtime:OperationRuntime,loans:Pick<LoanService,"createLoan">)=>{
 const service=new LoanRequestService(new DrizzleLoanRequestRepository(),loans,{
  async assertOwnOrFinance(actor,id) {
   if(actor.trustedActor?.employeeId!==String(id))runtime.context.assertGlobal(actor);
   await runtime.context.assertEmployee(actor,id,bangkokToday(),"submit");
   await runtime.context.context(id,bangkokToday());
  },
  async assertFinance(actor) { runtime.context.assertGlobal(actor); },
 });
 const create=service.createRequest.bind(service),approve=service.approveRequest.bind(service),reject=service.rejectRequest.bind(service);
 return Object.assign(service,{
  createRequest:(...args:Parameters<typeof create>)=>runOperation(runtime,args[0],"loan-request","create","loan_requests",async()=>({value:await create(...args)})),
  approveRequest:(...args:Parameters<typeof approve>)=>runOperation(runtime,args[0],"loan-request","approve","loan_requests",async()=>({value:await approve(...args)})),
  rejectRequest:(...args:Parameters<typeof reject>)=>runOperation(runtime,args[0],"loan-request","reject","loan_requests",async()=>({value:await reject(...args)})),
 });
};
