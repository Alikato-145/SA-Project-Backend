import type { OperationRuntime } from "../../core/db/operation-runtime";
import { runOperation } from "../../core/db/operation-runtime";
import { operationExecutor } from "../../core/db/operation-context";
import { ApplicationError } from "../../core/errors/application.error";
import { realDate, bangkokToday } from "../../shared/operation-validation";
import { AttendanceService } from "./attendance.service";
import { DrizzleAttendanceRepository } from "./attendance.repository";
import type { BranchScheduleService } from "../branch-schedule/branch-schedule.service";
import type { HolidayCalendarService } from "../holiday-calendar/holiday-calendar.service";
import type { CreateManualWorkDayCommand, AttendanceActor, WorkDayRangeFilter } from "./attendance.dto";
export const createAttendanceRuntimeService=(runtime:OperationRuntime,schedule:BranchScheduleService,holiday:HolidayCalendarService)=>{
 const repository=new DrizzleAttendanceRepository();
 const read=async(actor:AttendanceActor,filter:WorkDayRangeFilter)=>{
  if(filter.employeeId) { let date=realDate(filter.startDate);while(date<=filter.endDate) {await runtime.context.assertEmployee(actor,filter.employeeId,date,"read");const next=new Date(`${date}T00:00:00Z`);next.setUTCDate(next.getUTCDate()+1);date=next.toISOString().slice(0,10);} }
  else if(filter.branchId)await runtime.context.assertBranch(actor,filter.branchId,true);
  else runtime.context.assertGlobal(actor);
 };
 const service=new AttendanceService(repository,{
  assertCanManageWorkDay:async(actor,command)=>{await runtime.context.assertEmployee(actor,command.employeeId,command.workDate,"manage");},
  assertEmployeeAssignedToBranch:async(employeeId,branchId,date)=>{if((await runtime.context.context(employeeId,date)).branchId!==branchId)throw new ApplicationError("INVALID_ORGANIZATION_RELATION");},
  assertCanReadWorkDays:read,
 },{assertWorkDayCanBeCorrected:record=>runtime.payroll.assertInputsMutable(operationExecutor(),{employeeId:record.employeeId,startDate:record.workDate,endDate:record.workDate})});
 const validate=async(command:CreateManualWorkDayCommand)=>{
  realDate(command.workDate);
  const context=await runtime.context.context(command.employeeId,command.workDate);
  const applicable=await schedule.getApplicableSchedule(command.branchId,command.workDate);
  const isPublic=(await holiday.getActiveHoliday(context.shopId,command.workDate)).length>0;
  const isWeekly=await runtime.context.weeklyHoliday(command.employeeId,command.workDate) || (applicable.kind==="override" && applicable.override.isClosed);
  if((command.status==="public_holiday"&&!isPublic)||(command.status==="weekly_holiday"&&!isWeekly))throw new ApplicationError("INVALID_ATTENDANCE");
  if(["present","late","absent"].includes(command.status) && applicable.kind==="none")throw new ApplicationError("INVALID_SCHEDULE");
  if(command.status==="present" && command.lateMinutes!==0)throw new ApplicationError("INVALID_ATTENDANCE");
  if(command.status==="late" && command.lateMinutes<=0)throw new ApplicationError("INVALID_ATTENDANCE");
  if(command.clockInAt && applicable.kind!=="none" && ["present","late"].includes(command.status)) {
   const start=applicable.kind==="override" ? applicable.override.workStartTime : applicable.schedule.workStartTime;
   if(start) {const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Bangkok",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(command.clockInAt).split(":").map(Number);const [hours,minutes]=start.split(":").map(Number);const grace=applicable.kind==="schedule"?applicable.schedule.lateGraceMinutes:0;const late=Math.max(0,parts[0]!*60+parts[1]!-hours!*60-minutes!-grace);if(command.lateMinutes!==late || command.status!==(late>0?"late":"present"))throw new ApplicationError("INVALID_ATTENDANCE");}
  }
  const deductible=command.status==="absent" || command.status==="late";
  if(command.isDeductible!==deductible)throw new ApplicationError("INVALID_ATTENDANCE");
 };
 const create=service.createManualWorkDay.bind(service),correct=service.correctWorkDay.bind(service),find=service.findForPayrollRange.bind(service);
 return Object.assign(service,{
  async findForPayrollRange(actor:AttendanceActor,filter:WorkDayRangeFilter) {
   return runtime.context.visibleWorkDays(actor,await find(actor,filter));
  },

  createManualWorkDay:(actor:AttendanceActor,command:CreateManualWorkDayCommand)=>runOperation(runtime,actor,"attendance","create","work_day_records",async()=>{
   await runtime.context.assertEmployee(actor,command.employeeId,command.workDate,"manage");await runtime.payroll.assertInputsMutable(operationExecutor(),{employeeId:command.employeeId,startDate:command.workDate,endDate:command.workDate});await validate(command);return {value:await create(actor,command)};
  }),
  correctWorkDay:(actor:AttendanceActor,id:number,command:Parameters<typeof correct>[2])=>runOperation(runtime,actor,"attendance","correct","work_day_records",async()=>{
   const oldData=await repository.findById(id);if(!oldData)throw new ApplicationError("RESOURCE_NOT_FOUND");await runtime.context.assertEmployee(actor,oldData.employeeId,oldData.workDate,"manage");await validate({...oldData,...command});return {value:await correct(actor,id,command),oldData};
  }),
 });
};
