import type { OperationRuntime } from "../../core/db/operation-runtime";
import { runOperation } from "../../core/db/operation-runtime";
import { operationExecutor } from "../../core/db/operation-context";
import { ApplicationError } from "../../core/errors/application.error";
import { realDate, bangkokToday } from "../../shared/operation-validation";
import { LoanService } from "./loan.service";
import { DrizzleLoanRepository } from "./loan.repository";
export const createLoanRuntimeService=(runtime:OperationRuntime)=>{
 const repository=new DrizzleLoanRepository();
 const service=new LoanService(repository,{
  assertCanCreate:async(actor,id)=>{await runtime.context.assertEmployee(actor,id,bangkokToday(),"finance");},
  assertCanRead:async(actor,id)=>{await runtime.context.assertEmployee(actor,id,bangkokToday(),"read");},
 },{assertPayrollLocked:async()=>{throw new ApplicationError("FORBIDDEN_SCOPE");}});
 const create=service.createLoan.bind(service);
 return Object.assign(service,{
  createLoan:(actor:Parameters<typeof create>[0],command:Parameters<typeof create>[1])=>runOperation(runtime,actor,"loan","create","loans",async()=>{
   await runtime.context.assertEmployee(actor,command.employeeId,command.firstDueMonth,"finance");realDate(command.firstDueMonth);if(!command.firstDueMonth.endsWith("-01"))throw new ApplicationError("LOAN_INVALID_INSTALLMENTS");const end=new Date(`${command.firstDueMonth}T00:00:00Z`);end.setUTCMonth(end.getUTCMonth()+command.installmentCount);end.setUTCDate(0);
   await runtime.payroll.assertInputsMutable(operationExecutor(),{employeeId:command.employeeId,startDate:command.firstDueMonth,endDate:end.toISOString().slice(0,10)});return {value:await create(actor,command)};
  }),
 });
};
