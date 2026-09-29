import { t } from "elysia";
import { operationTransport, type OperationTransportOptions } from "../../core/middleware/operation-transport";
import { operationId as id, operationDate as date, operationMoney as money } from "../../shared/operation-validation";
const object=(fields:any)=>t.Object(fields,{additionalProperties:false});
const params=object({id});
const employeeQuery=object({employee_id:id});
const text=t.Optional(t.String({maxLength:1000}));
const nullableText=t.Optional(t.Union([t.String({maxLength:1000}),t.Null()]));
import { HolidayCalendarController } from "./holiday-calendar.controller";
export const createHolidayCalendarRoutes=(options:OperationTransportOptions & {controller:HolidayCalendarController})=> operationTransport("b5-holiday-calendar",options)

 .get("/holiday-calendars",({actor,query})=>options.controller.list({actor,shopId:query.shop_id,holidayDate:query.holiday_date,activeOnly:query.active_only}),{query:object({shop_id:id,holiday_date:t.Optional(date),active_only:t.Optional(t.Union([t.Literal("true"),t.Literal("false")]))})})
 .post("/holiday-calendars",({actor,body})=>options.controller.create({actor,command:body}),{body:object({shop_id:id,holiday_date:date,name:t.String({minLength:1,maxLength:100})})})
 .patch("/holiday-calendars/:id",({actor,params,body})=>options.controller.update({actor,id:params.id,command:body}),{params,body:object({name:t.Optional(t.String({minLength:1,maxLength:100})),is_active:t.Optional(t.Boolean())})});
