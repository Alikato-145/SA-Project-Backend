import type { OperationRuntime } from "../../core/db/operation-runtime";
import { runOperation } from "../../core/db/operation-runtime";
import { operationExecutor } from "../../core/db/operation-context";
import { ApplicationError } from "../../core/errors/application.error";
import { realDate, bangkokToday } from "../../shared/operation-validation";
import { HolidayCalendarService } from "./holiday-calendar.service";
import { DrizzleHolidayCalendarRepository } from "./holiday-calendar.repository";
export const createHolidayCalendarRuntimeService=(runtime:OperationRuntime)=>{
 const repository=new DrizzleHolidayCalendarRepository();
 const service=new HolidayCalendarService(repository,{assertCanManageShop:(actor,id)=>runtime.context.assertShop(actor,id),assertCanReadShop:(actor,id)=>runtime.context.assertShop(actor,id,true)});
 const create=service.createHoliday.bind(service),update=service.updateHoliday.bind(service);
 return Object.assign(service,{
  createHoliday:(actor:Parameters<typeof create>[0],command:Parameters<typeof create>[1])=>runOperation(runtime,actor,"holiday","create","holiday_calendars",async()=>{
   await runtime.context.assertShop(actor,command.shopId);realDate(command.holidayDate);await runtime.payroll.assertInputsMutable(operationExecutor(),{shopId:command.shopId,startDate:command.holidayDate,endDate:command.holidayDate});return {value:await create(actor,command)};
  }),
  updateHoliday:(actor:Parameters<typeof update>[0],id:number,command:Parameters<typeof update>[2])=>runOperation(runtime,actor,"holiday","update","holiday_calendars",async()=>{
   const oldData=await repository.findById(id);if(!oldData)throw new ApplicationError("RESOURCE_NOT_FOUND");
   await runtime.context.assertShop(actor,oldData.shopId);await runtime.payroll.assertInputsMutable(operationExecutor(),{shopId:oldData.shopId,startDate:oldData.holidayDate,endDate:oldData.holidayDate});return {value:await update(actor,id,command),oldData};
  }),
 });
};
