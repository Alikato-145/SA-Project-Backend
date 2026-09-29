import type { HolidayCalendarService } from "./holiday-calendar.service";
import { operationCommand, operationSuccess, publicOperationData } from "../../shared/operation-mapper";
import { databaseId } from "../../shared/operation-validation";
export class HolidayCalendarController {
 constructor(private readonly service: Pick<HolidayCalendarService,keyof HolidayCalendarService>) {}
 private response(actor:any,value:any) { return operationSuccess(publicOperationData(value),actor.requestId); }

 async create(input:any) { return this.response(input.actor,await this.service.createHoliday(input.actor,operationCommand(input.command))); }
 async list(input:any) { return this.response(input.actor,await this.service.listHolidays(input.actor,databaseId(input.shopId),{holidayDate:input.holidayDate,activeOnly:input.activeOnly===true||input.activeOnly==="true"})); }
 async update(input:any) { return this.response(input.actor,await this.service.updateHoliday(input.actor,databaseId(input.id),operationCommand(input.command))); }
}
