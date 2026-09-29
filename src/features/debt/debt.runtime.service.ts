import type { OperationRuntime } from "../../core/db/operation-runtime";
import { runOperation } from "../../core/db/operation-runtime";
import { operationExecutor } from "../../core/db/operation-context";
import { ApplicationError } from "../../core/errors/application.error";
import { realDate, bangkokToday } from "../../shared/operation-validation";
import { DebtService } from "./debt.service";
import { DrizzleDebtRepository } from "./debt.repository";
export const createDebtRuntimeService=(runtime:OperationRuntime)=>{
 const repository=new DrizzleDebtRepository(id=>runtime.payroll.getDebtSettlement(operationExecutor(),id));
 const service=new DebtService(repository,{assertCanRecord:async(actor,id)=>{await runtime.context.assertEmployee(actor,id,bangkokToday(),"finance");},assertCanRead:async(actor,id)=>{await runtime.context.assertEmployee(actor,id,bangkokToday(),"read");}},bangkokToday);
 const record=service.record.bind(service),reverse=service.reverse.bind(service);
 return Object.assign(service,{
  record:(actor:Parameters<typeof record>[0],command:Parameters<typeof record>[1])=>runOperation(runtime,actor,"debt","create","debt_transactions",async()=>{
   await runtime.context.assertEmployee(actor,command.employeeId,bangkokToday(),"finance");const date=bangkokToday();await runtime.payroll.assertInputsMutable(operationExecutor(),{employeeId:command.employeeId,startDate:date,endDate:date});return {value:await record(actor,command)};
  }),
  reverse:(actor:Parameters<typeof reverse>[0],id:number,description:string)=>runOperation(runtime,actor,"debt","reverse","debt_transactions",async()=>{
   const oldData=await repository.findById(id);if(oldData)await runtime.context.assertEmployee(actor,oldData.employeeId,oldData.transactionDate,"finance");if(oldData)await runtime.payroll.assertInputsMutable(operationExecutor(),{employeeId:oldData.employeeId,startDate:oldData.transactionDate,endDate:bangkokToday()});return {value:await reverse(actor,id,description),oldData};
  }),
 });
};
