import type { OperationRuntime } from "../../core/db/operation-runtime";
import { runOperation } from "../../core/db/operation-runtime";
import { operationExecutor } from "../../core/db/operation-context";
import { ApplicationError } from "../../core/errors/application.error";
import { realDate, bangkokToday } from "../../shared/operation-validation";
import { OvertimeService } from "./overtime.service";
import { DrizzleOvertimeRepository } from "./overtime.repository";
import type { BranchScheduleService } from "../branch-schedule/branch-schedule.service";
import type { HolidayCalendarService } from "../holiday-calendar/holiday-calendar.service";
import type { AttendanceService } from "../attendance/attendance.service";
export const createOvertimeRuntimeService=(runtime:OperationRuntime,schedule:BranchScheduleService,holiday:HolidayCalendarService,attendance:AttendanceService)=>{
 const repository=new DrizzleOvertimeRepository();
 const service=new OvertimeService(repository,{
  assertCanSubmit:async(actor,id,date)=>{await runtime.context.assertEmployee(actor,id,date,"submit");},
  assertCanDecide:async(actor,id,date)=>{actor.scope=await runtime.context.assertEmployee(actor,id,date,"decide");},
  assertCanRead:async(actor,id)=>{await runtime.context.assertEmployee(actor,id,bangkokToday(),"read");},
 },{assertEligible:async (command,actor)=>{
  const context=await runtime.context.context(command.employeeId,command.overtimeDate);
  const applicable=await schedule.getApplicableSchedule(context.branchId,command.overtimeDate);
  const weekly=await runtime.context.weeklyHoliday(command.employeeId,command.overtimeDate)||(applicable.kind==="override"&&applicable.override.isClosed);
  const publicHoliday=(await holiday.getActiveHoliday(context.shopId,command.overtimeDate)).length>0;
  if((command.overtimeType==="rest_day"&&!weekly)||(command.overtimeType==="public_holiday"&&!publicHoliday)||(command.overtimeType==="hourly"&&applicable.kind==="none"))throw new ApplicationError("OVERTIME_CONTEXT_INVALID");
  if(command.workDayRecordId) {const rows=await attendance.findForPayrollRange(actor!,{employeeId:command.employeeId,startDate:command.overtimeDate,endDate:command.overtimeDate});if(!rows.some(row=>row.id===command.workDayRecordId))throw new ApplicationError("OVERTIME_CONTEXT_INVALID");}
 }},{assertDateUnlocked:(tx,id,date)=>runtime.payroll.assertInputsMutable(tx as any,{employeeId:id,startDate:date,endDate:date})});
 const approve=service.approveOvertime.bind(service),reject=service.rejectOvertime.bind(service);
 return Object.assign(service,{
  submitOvertime:(actor:Parameters<OvertimeService["submitOvertime"]>[0],command:Parameters<OvertimeService["submitOvertime"]>[1])=>runOperation(runtime,actor,"overtime","submit","overtime_records",async()=>{
   return {value:await OvertimeService.prototype.submitOvertime.call(service,actor,command)};
  }),
  approveOvertime:(actor:Parameters<typeof approve>[0],id:number,remark?:string)=>runOperation(runtime,actor,"overtime","approve","overtime_records",async()=>{const oldData=await repository.findById(id);return {value:await approve(actor,id,remark),oldData};}),
  rejectOvertime:(actor:Parameters<typeof reject>[0],id:number,remark?:string)=>runOperation(runtime,actor,"overtime","reject","overtime_records",async()=>{const oldData=await repository.findById(id);return {value:await reject(actor,id,remark),oldData};}),
  async listRequests(actor:Parameters<typeof approve>[0],employeeId:number) {
   const rows=await repository.listByEmployee(employeeId);if(!rows.length)await runtime.context.assertEmployee(actor,employeeId,bangkokToday(),"read");const visible=[];
   for(const row of rows) {try {await runtime.context.assertEmployee(actor,employeeId,row.overtimeDate,"read");visible.push(row);}catch(error){if(!(error instanceof ApplicationError)||error.code!=="FORBIDDEN_SCOPE")throw error;}}
   if(rows.length && !visible.length)throw new ApplicationError("FORBIDDEN_SCOPE");return visible;
  },
  async getHistory(actor:Parameters<typeof approve>[0],id:number) {const record=await repository.findById(id);if(!record)throw new ApplicationError("RESOURCE_NOT_FOUND");await runtime.context.assertEmployee(actor,record.employeeId,record.overtimeDate,"read");return repository.history(id);},
 });
};
