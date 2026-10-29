import type { OperationRuntime } from "../../core/db/operation-runtime";
import { runOperation } from "../../core/db/operation-runtime";
import { operationExecutor } from "../../core/db/operation-context";
import { ApplicationError } from "../../core/errors/application.error";
import { parseActiveGrant } from "../../core/auth/authorization";
import { realDate, bangkokToday } from "../../shared/operation-validation";
import { AttendanceService } from "./attendance.service";
import { defaultScheduledTimes } from "./attendance-default-clock";
import { DrizzleAttendanceRepository } from "./attendance.repository";
import type { BranchScheduleService } from "../branch-schedule/branch-schedule.service";
import type { HolidayCalendarService } from "../holiday-calendar/holiday-calendar.service";
import type { CreateManualWorkDayCommand, AttendanceActor, WorkDayRangeFilter } from "./attendance.dto";
export const createAttendanceRuntimeService=(runtime:OperationRuntime,schedule:BranchScheduleService,holiday:HolidayCalendarService)=>{
 const repository=new DrizzleAttendanceRepository();
 const manage=async(actor:AttendanceActor,command:Pick<CreateManualWorkDayCommand,"employeeId"|"workDate">)=>{
  try { return await runtime.context.assertEmployee(actor,command.employeeId,command.workDate,"manage"); }
  catch(error) {
   if(!(error instanceof ApplicationError)||error.code!=="FORBIDDEN_SCOPE")throw error;
   const user=actor.trustedActor;
   if(user?.employeeId===String(command.employeeId) && user.grants.some(candidate=>{const grant=parseActiveGrant(candidate);return grant?.roleCode==="EMPLOYEE"&&grant.scope==="self";}))return "self" as const;
   throw error;
  }
 };
 const assertSelfRecord=(command:CreateManualWorkDayCommand)=>{
  if(!["present","late","absent"].includes(command.status) ||
   (command.status==="absent" ? Boolean(command.clockInAt||command.clockOutAt) : !command.clockInAt))throw new ApplicationError("INVALID_ATTENDANCE");
 };
 const read=async(actor:AttendanceActor,filter:WorkDayRangeFilter)=>{
  if(filter.employeeId) { let authorized=false;let date=realDate(filter.startDate);while(date<=filter.endDate) {try {await runtime.context.assertEmployee(actor,filter.employeeId,date,"read");authorized=true;}catch(error){if(!(error instanceof ApplicationError)||error.code!=="PAYROLL_ASSIGNMENT_MISSING")throw error;}const next=new Date(`${date}T00:00:00Z`);next.setUTCDate(next.getUTCDate()+1);date=next.toISOString().slice(0,10);}if(!authorized)throw new ApplicationError("FORBIDDEN_SCOPE"); }
  else if(filter.branchId)await runtime.context.assertBranch(actor,filter.branchId,true);
  else runtime.context.assertGlobal(actor);
 };
 const service=new AttendanceService(repository,{
  assertCanManageWorkDay:async(actor,command)=>{await manage(actor,command);},
  assertEmployeeAssignedToBranch:async(employeeId,branchId,date)=>{if((await runtime.context.context(employeeId,date)).branchId!==branchId)throw new ApplicationError("INVALID_ORGANIZATION_RELATION");},
  assertCanReadWorkDays:read,
 },{assertWorkDayCanBeCorrected:record=>runtime.payroll.assertInputsMutable(operationExecutor(),{employeeId:record.employeeId,startDate:record.workDate,endDate:record.workDate})});
 const validate=async(command:CreateManualWorkDayCommand,self=false)=>{
  realDate(command.workDate);
  const context=await runtime.context.context(command.employeeId,command.workDate);
  if(context.branchId!==command.branchId)throw new ApplicationError("INVALID_ORGANIZATION_RELATION");
  const applicable=await schedule.getApplicableSchedule(command.branchId,command.workDate);
  const isPublic=(await holiday.getActiveHoliday(context.shopId,command.workDate)).length>0;
  const isWeekly=await runtime.context.weeklyHoliday(command.employeeId,command.workDate) || (applicable.kind==="override" && applicable.override.isClosed);
  if(self) {assertSelfRecord(command);if(isPublic||isWeekly)throw new ApplicationError("INVALID_ATTENDANCE");}
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
  async getCalendar(actor:AttendanceActor,employeeId:number,startDate:string,endDate:string) {
   const records=await service.findForPayrollRange(actor,{employeeId,startDate,endDate});
   const days=[];
   for(const cursor=new Date(`${startDate}T00:00:00Z`);cursor.toISOString().slice(0,10)<=endDate;cursor.setUTCDate(cursor.getUTCDate()+1)) {
    const date=cursor.toISOString().slice(0,10);
    let context;
    try {context=await runtime.context.context(employeeId,date);}catch(error){if(!(error instanceof ApplicationError)||error.code!=="PAYROLL_ASSIGNMENT_MISSING")throw error;days.push({date,status:"not_employed",branchId:null,branchName:null,recordId:null});continue;}
    const record=records.find(row=>row.workDate===date);
    const applicable=await schedule.getApplicableSchedule(context.branchId,date);
    const weekly=await runtime.context.weeklyHoliday(employeeId,date)||(applicable.kind==="override"&&applicable.override.isClosed);
    const isPublic=(await holiday.getActiveHoliday(context.shopId,date)).length>0;
    days.push({date,status:record?.status ?? (weekly ? "weekly_holiday" : isPublic ? "public_holiday" : applicable.kind==="none" ? "schedule_missing" : "missing"),branchId:context.branchId,branchName:context.branchName,recordId:record?.id ?? null});
   }
   return days;
  },
  async getWorkDayContext(actor:AttendanceActor,employeeId:number,date:string) {
   await runtime.context.assertEmployee(actor,employeeId,realDate(date),"read");
   const context=await runtime.context.context(employeeId,date);
   const applicable=await schedule.getApplicableSchedule(context.branchId,date);
   const holidays=await holiday.getActiveHoliday(context.shopId,date);
   const weekly=await runtime.context.weeklyHoliday(employeeId,date);
   return {employeeId,branchId:context.branchId,branchName:context.branchName,shopId:context.shopId,applicable,weeklyHoliday:weekly,publicHoliday:holidays.length>0};
  },
  async findForPayrollRange(actor:AttendanceActor,filter:WorkDayRangeFilter) {
   return runtime.context.visibleWorkDays(actor,await find(actor,filter));
  },

  createManualWorkDay:(actor:AttendanceActor,command:CreateManualWorkDayCommand)=>runOperation(runtime,actor,"attendance","create","work_day_records",async()=>{
   const scope=await manage(actor,command);await runtime.payroll.assertInputsMutable(operationExecutor(),{employeeId:command.employeeId,startDate:command.workDate,endDate:command.workDate});
   if(command.status==="present" && command.lateMinutes===0 && !command.clockInAt && !command.clockOutAt) command=defaultScheduledTimes(command,await schedule.getApplicableSchedule(command.branchId,command.workDate));
   await validate(command,scope==="self");return {value:await create(actor,command)};
  }),
  correctWorkDay:(actor:AttendanceActor,id:number,command:Parameters<typeof correct>[2])=>runOperation(runtime,actor,"attendance","correct","work_day_records",async()=>{
   const oldData=await repository.findById(id);if(!oldData)throw new ApplicationError("RESOURCE_NOT_FOUND");const scope=await manage(actor,oldData);
   await runtime.payroll.assertInputsMutable(operationExecutor(),{employeeId:oldData.employeeId,startDate:oldData.workDate,endDate:oldData.workDate});
   if(scope==="self") {
    if(oldData.entrySource!=="manual"||!["present","late","absent"].includes(oldData.status))throw new ApplicationError("INVALID_ATTENDANCE");
    const reason=command.note?.trim();
    if(!reason||reason.length<5||reason.length>1000||!/[\p{L}\p{N}]/u.test(reason))throw new ApplicationError("INVALID_ATTENDANCE",{publicMessage:"ระบุเหตุผลการแก้ไข 5–1,000 ตัวอักษร"});
    command={...command,note:reason};
   }
   await validate({...oldData,...command},scope==="self");return {value:await correct(actor,id,command),oldData};
  }),
 });
};
