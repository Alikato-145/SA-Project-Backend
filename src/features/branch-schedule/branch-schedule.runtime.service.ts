import type { OperationRuntime } from "../../core/db/operation-runtime";
import { runOperation } from "../../core/db/operation-runtime";
import { operationExecutor } from "../../core/db/operation-context";
import { ApplicationError } from "../../core/errors/application.error";
import { realDate, bangkokToday } from "../../shared/operation-validation";
import { BranchScheduleService } from "./branch-schedule.service";
import { DrizzleBranchScheduleRepository } from "./branch-schedule.repository";
export const createBranchScheduleRuntimeService=(runtime:OperationRuntime)=>{
 const repository=new DrizzleBranchScheduleRepository();
 const service=new BranchScheduleService(repository,{assertCanManageBranch:(actor,id)=>runtime.context.assertBranch(actor,id),assertCanReadBranch:(actor,id)=>runtime.context.assertBranch(actor,id,true)});
 const create=service.createSchedule.bind(service),update=service.updateSchedule.bind(service),override=service.upsertOverride.bind(service);
 return Object.assign(service,{
  createSchedule:(actor:Parameters<typeof create>[0],command:Parameters<typeof create>[1])=>runOperation(runtime,actor,"schedule","create","branch_schedules",async()=>{
   await runtime.context.assertBranch(actor,command.branchId);realDate(command.effectiveFrom);if(command.effectiveTo)realDate(command.effectiveTo);
   await runtime.payroll.assertInputsMutable(operationExecutor(),{branchId:command.branchId,startDate:command.effectiveFrom,endDate:command.effectiveTo ?? "9999-12-31"});
   return {value:await create(actor,command)};
  }),
  updateSchedule:(actor:Parameters<typeof update>[0],id:number,command:Parameters<typeof update>[2])=>runOperation(runtime,actor,"schedule","update","branch_schedules",async()=>{
   const oldData=await repository.findScheduleById(id); if(!oldData)throw new ApplicationError("RESOURCE_NOT_FOUND");
   await runtime.context.assertBranch(actor,oldData.branchId);if(!command.effectiveFrom)throw new ApplicationError("VALIDATION_ERROR");realDate(command.effectiveFrom);if(command.effectiveTo)realDate(command.effectiveTo);
   await runtime.payroll.assertInputsMutable(operationExecutor(),{branchId:oldData.branchId,startDate:command.effectiveFrom,endDate:command.effectiveTo ?? "9999-12-31"});
   return {value:await update(actor,id,command),oldData};
  }),
  upsertOverride:(actor:Parameters<typeof override>[0],command:Parameters<typeof override>[1])=>runOperation(runtime,actor,"schedule","override","branch_schedule_overrides",async()=>{
   await runtime.context.assertBranch(actor,command.branchId);realDate(command.scheduleDate);await runtime.payroll.assertInputsMutable(operationExecutor(),{branchId:command.branchId,startDate:command.scheduleDate,endDate:command.scheduleDate});
   const oldData=await repository.findOverride(command.branchId,command.scheduleDate);return {value:await override(actor,command),oldData};
  }),
 });
};
