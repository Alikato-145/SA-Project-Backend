import { t } from "elysia";
import { operationTransport, type OperationTransportOptions } from "../../core/middleware/operation-transport";
import { operationId as id, operationDate as date, operationMoney as money } from "../../shared/operation-validation";
const object=(fields:any)=>t.Object(fields,{additionalProperties:false});
const params=object({id});
const employeeQuery=object({employee_id:id});
const text=t.Optional(t.String({maxLength:1000}));
const nullableText=t.Optional(t.Union([t.String({maxLength:1000}),t.Null()]));
import { AttendanceController } from "./attendance.controller";

const fields={status:t.Union([t.Literal("present"),t.Literal("late"),t.Literal("absent"),t.Literal("leave"),t.Literal("weekly_holiday"),t.Literal("public_holiday")]), clock_in_at:t.Optional(t.Union([t.String({format:"date-time"}),t.Null()])),clock_out_at:t.Optional(t.Union([t.String({format:"date-time"}),t.Null()])),late_minutes:t.Integer({minimum:0}),is_deductible:t.Boolean(),note:nullableText};
export const createAttendanceRoutes=(options:OperationTransportOptions & {controller:AttendanceController})=> operationTransport("b5-attendance",options)

 .get("/work-day-records",({actor,query})=>options.controller.list({actor,filter:query}),{query:object({employee_id:t.Optional(id),branch_id:t.Optional(id),start_date:date,end_date:date})})
 .post("/work-day-records",({actor,body})=>options.controller.create({actor,command:body}),{body:object({employee_id:id,branch_id:id,work_date:date,...fields})})
 .patch("/work-day-records/:id",({actor,body,params})=>options.controller.correct({actor,id:params.id,command:body}),{params,body:t.Partial(object(fields))});
