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
  async listTypes(actor: Parameters<typeof record>[0]) { runtime.context.assertGlobal(actor); return repository.listTypes(); },
  async listManagedTypes(actor:Parameters<typeof record>[0]) {runtime.context.assertGlobal(actor);return repository.listManagedTypes();},
  saveType:(actor:Parameters<typeof record>[0],command:{code:string;nameTh:string;description:string|null;isActive:boolean},id?:number)=>runOperation(runtime,actor,"debt","type_update","debt_types",async()=>{
   runtime.context.assertGlobal(actor);
   if(!/^[A-Z][A-Z0-9_]{0,29}$/.test(command.code)||!command.nameTh.trim()||command.nameTh.length>100||(command.description?.length ?? 0)>1000)throw new ApplicationError("VALIDATION_ERROR");
   const oldData=id ? await repository.findTypeForUpdate(id):undefined;
   if(id && !oldData)throw new ApplicationError("RESOURCE_NOT_FOUND");
   if(oldData && oldData.code!==command.code && await repository.hasTypeReferences(id!))throw new ApplicationError("STATE_CONFLICT",{publicMessage:"ประเภทหนี้นี้ใช้งานแล้ว เปลี่ยนรหัสไม่ได้ ให้สร้างประเภทใหม่"});
   return {value:await repository.saveType(command,id),oldData};
  }),
  record:(actor:Parameters<typeof record>[0],command:Parameters<typeof record>[1])=>runOperation(runtime,actor,"debt","create","debt_transactions",async()=>{
   await runtime.context.assertEmployee(actor,command.employeeId,bangkokToday(),"finance");const date=bangkokToday();await runtime.payroll.assertInputsMutable(operationExecutor(),{employeeId:command.employeeId,startDate:date,endDate:date});return {value:await record(actor,command)};
  }),
  reverse:(actor:Parameters<typeof reverse>[0],id:number,description:string)=>runOperation(runtime,actor,"debt","reverse","debt_transactions",async()=>{
   const oldData=await repository.findById(id);if(oldData)await runtime.context.assertEmployee(actor,oldData.employeeId,oldData.transactionDate,"finance");if(oldData)await runtime.payroll.assertInputsMutable(operationExecutor(),{employeeId:oldData.employeeId,startDate:oldData.transactionDate,endDate:bangkokToday()});return {value:await reverse(actor,id,description),oldData};
  }),
 });
};
