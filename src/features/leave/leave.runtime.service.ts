import type { OperationRuntime } from "../../core/db/operation-runtime";
import { runOperation } from "../../core/db/operation-runtime";
import { operationExecutor } from "../../core/db/operation-context";
import { ApplicationError } from "../../core/errors/application.error";
import { realDate, bangkokToday } from "../../shared/operation-validation";
import { LeaveService,datesInclusive } from "./leave.service";
import { DrizzleLeaveRepository } from "./leave.repository";
import type { AttendanceLeaveEffect } from "../attendance/attendance-leave-effect.service";
export const createLeaveRuntimeService=(runtime:OperationRuntime,attendance:AttendanceLeaveEffect)=>{
 const repository=new DrizzleLeaveRepository();
 const datesAccess=async(actor:any,employeeId:number,dates:string[],action:"submit"|"decide")=>{
  const scopes=await Promise.all(dates.map(date=>runtime.context.assertEmployee(actor,employeeId,date,action)));
  actor.scope=scopes.includes("self")?"self":scopes.includes("department")?"department":scopes.includes("branch")?"branch":"all";
 };
 const service=new LeaveService(repository,{
  assertCanSubmit:(actor,id,dates)=>datesAccess(actor,id,dates,"submit"),assertCanDecide:(actor,id,dates)=>datesAccess(actor,id,dates,"decide"),
  assertCanRead:async(actor,id)=>{await runtime.context.assertEmployee(actor,id,bangkokToday(),"read");},
 },attendance,{assertDatesUnlocked:async(tx,id,dates)=>{await runtime.payroll.assertInputsMutable(tx as any,{employeeId:id,startDate:dates[0]!,endDate:dates.at(-1)!});}});
 const submit=service.submitLeave.bind(service),update=service.updateLeave.bind(service),approve=service.approveLeave.bind(service),reject=service.rejectLeave.bind(service);
 return Object.assign(service,{
  submitLeave:(actor:Parameters<typeof submit>[0],command:Parameters<typeof submit>[1])=>runOperation(runtime,actor,"leave","submit","leave_requests",async()=>{
   await datesAccess(actor,command.employeeId,datesInclusive(command.startDate,command.endDate),"submit");await runtime.payroll.assertInputsMutable(operationExecutor(),{employeeId:command.employeeId,startDate:realDate(command.startDate),endDate:realDate(command.endDate)});return {value:await submit(actor,command)};
  }),
  updateLeave:(actor:Parameters<typeof update>[0],id:number,command:Parameters<typeof update>[2])=>runOperation(runtime,actor,"leave","update","leave_requests",async()=>{
   const oldData=await repository.findById(id);if(!oldData)throw new ApplicationError("RESOURCE_NOT_FOUND");await datesAccess(actor,oldData.employeeId,datesInclusive(command.startDate,command.endDate),"submit");await runtime.payroll.assertInputsMutable(operationExecutor(),{employeeId:oldData.employeeId,startDate:realDate(command.startDate),endDate:realDate(command.endDate)});return {value:await update(actor,id,command),oldData};
  }),
  approveLeave:(actor:Parameters<typeof approve>[0],id:number,typeId?:number)=>runOperation(runtime,actor,"leave","approve","leave_requests",async()=>{
   const oldData=await repository.findById(id);return {value:await approve(actor,id,typeId),oldData};
  }),
  rejectLeave:(actor:Parameters<typeof reject>[0],id:number,remark?:string)=>runOperation(runtime,actor,"leave","reject","leave_requests",async()=>{
   const oldData=await repository.findById(id);if(oldData)await datesAccess(actor,oldData.employeeId,datesInclusive(oldData.startDate,oldData.endDate),"decide");if(oldData)await runtime.payroll.assertInputsMutable(operationExecutor(),{employeeId:oldData.employeeId,startDate:oldData.startDate,endDate:oldData.endDate});return {value:await reject(actor,id,remark),oldData};
  }),
  async listRequests(actor:Parameters<typeof submit>[0],employeeId:number) {
   const rows=await repository.listByEmployee(employeeId);if(!rows.length)await runtime.context.assertEmployee(actor,employeeId,bangkokToday(),"read");const visible=[];
   for(const row of rows) {try {for(const date of datesInclusive(row.startDate,row.endDate))await runtime.context.assertEmployee(actor,employeeId,date,"read");visible.push(row);}catch(error){if(!(error instanceof ApplicationError)||error.code!=="FORBIDDEN_SCOPE")throw error;}}
   if(rows.length && !visible.length)throw new ApplicationError("FORBIDDEN_SCOPE");return visible;
  },
  async listTypes(actor:Parameters<typeof submit>[0]) {if(!actor.trustedActor)throw new ApplicationError("AUTH_REQUIRED");return (await repository.listTypes()).map(row=>({...row,name:row.nameTh}));},
  async listQuotas(actor:Parameters<typeof submit>[0],employeeId:number,year:number) {await runtime.context.assertEmployee(actor,employeeId,bangkokToday(),"read");return repository.listQuotas(employeeId,year);},
  async getHistory(actor:Parameters<typeof submit>[0],id:number) {const record=await repository.findById(id);if(!record)throw new ApplicationError("RESOURCE_NOT_FOUND");await datesAccess(actor,record.employeeId,datesInclusive(record.startDate,record.endDate),"submit");return repository.history(id);},
 });
};
