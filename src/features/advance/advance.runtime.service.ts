import type { OperationRuntime } from "../../core/db/operation-runtime";
import { runOperation } from "../../core/db/operation-runtime";
import { operationExecutor } from "../../core/db/operation-context";
import { ApplicationError } from "../../core/errors/application.error";
import { realDate, bangkokToday } from "../../shared/operation-validation";
import { AdvanceService } from "./advance.service";
import { DrizzleAdvanceRepository } from "./advance.repository";
import { advanceThresholds } from "../../core/config/advance.config";
import type { AttendanceService } from "../attendance/attendance.service";
export const createAdvanceRuntimeService=(runtime:OperationRuntime,attendance:AttendanceService)=>{
 const repository=new DrizzleAdvanceRepository();
 const service=new AdvanceService(repository,{
  assertCanRequest:async(actor,id)=>{await runtime.context.assertEmployee(actor,id,bangkokToday(),"submit");},
  assertCanDecide:async(actor,id,date)=>{await runtime.context.assertEmployee(actor,id,date,"finance");},
  assertCanRead:async(actor,id)=>{await runtime.context.assertEmployee(actor,id,bangkokToday(),"read");},
 },{getWorkedDays:(actor,id,start,end)=>attendance.countWorkedDaysForAdvance(actor,id,start,end),getBaseSalary:async(id,date)=>(await runtime.context.context(id,date)).baseSalary},
 {netPayAfterAdvance:(employeeId,month,amount,requestId,date)=>runtime.payroll.projectAdvance(operationExecutor(),{employeeId,date:date ?? bangkokToday(),amount,requestId})},bangkokToday,advanceThresholds());
 const submit=service.submitAdvance.bind(service),approve=service.approveAdvance.bind(service),reject=service.rejectAdvance.bind(service);
 return Object.assign(service,{
  submitAdvance:(actor:Parameters<typeof submit>[0],id:number,amount:string)=>runOperation(runtime,actor,"advance","submit","advance_requests",async()=>{
   await runtime.context.assertEmployee(actor,id,bangkokToday(),"submit");const date=bangkokToday();await runtime.payroll.assertInputsMutable(operationExecutor(),{employeeId:id,startDate:`${date.slice(0,7)}-01`,endDate:date});return {value:await submit(actor,id,amount)};
  }),
  approveAdvance:(actor:Parameters<typeof approve>[0],id:number)=>runOperation(runtime,actor,"advance","approve","advance_requests",async()=>{
   const oldData=await repository.findById(id);if(oldData)await runtime.context.assertEmployee(actor,oldData.employeeId,oldData.requestMonth,"finance");if(oldData)await runtime.payroll.assertInputsMutable(operationExecutor(),{employeeId:oldData.employeeId,startDate:oldData.requestMonth,endDate:new Date(Date.UTC(Number(oldData.requestMonth.slice(0,4)),Number(oldData.requestMonth.slice(5,7)),0)).toISOString().slice(0,10)});return {value:await approve(actor,id),oldData};
  }),
  rejectAdvance:(actor:Parameters<typeof reject>[0],id:number,note?:string)=>runOperation(runtime,actor,"advance","reject","advance_requests",async()=>{
   const oldData=await repository.findById(id);if(oldData)await runtime.context.assertEmployee(actor,oldData.employeeId,oldData.requestMonth,"finance");if(oldData)await runtime.payroll.assertInputsMutable(operationExecutor(),{employeeId:oldData.employeeId,startDate:oldData.requestMonth,endDate:bangkokToday()});return {value:await reject(actor,id,note),oldData};
  }),
 });
};
