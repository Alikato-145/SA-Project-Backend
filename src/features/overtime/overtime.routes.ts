import { t } from "elysia";
import { operationTransport, type OperationTransportOptions } from "../../core/middleware/operation-transport";
import { operationId as id, operationDate as date, operationMoney as money } from "../../shared/operation-validation";
const object=(fields:any)=>t.Object(fields,{additionalProperties:false});
const params=object({id});
const employeeQuery=object({employee_id:id});
const text=t.Optional(t.String({maxLength:1000}));
const nullableText=t.Optional(t.Union([t.String({maxLength:1000}),t.Null()]));
import { OvertimeController } from "./overtime.controller";
export const createOvertimeRoutes=(options:OperationTransportOptions & {controller:OvertimeController})=> operationTransport("b5-overtime",options)

 .get("/overtime-records/:id/history",({actor,params})=>options.controller.history(actor,params.id),{params})
 .get("/overtime-records",({actor,query})=>options.controller.list(actor,query.employee_id),{query:employeeQuery})
 .post("/overtime-records",({actor,body})=>options.controller.submit(actor,body),{body:object({employee_id:id,overtime_date:date,overtime_type:t.Union([t.Literal("hourly"),t.Literal("rest_day"),t.Literal("public_holiday")]),hours:t.Optional(money),day_units:t.Optional(money),work_day_record_id:t.Optional(id),reason:text})})
 .post("/overtime-records/:id/approve",({actor,params,body})=>options.controller.approve(actor,params.id,body),{params,body:object({remark:text})})
 .post("/overtime-records/:id/reject",({actor,params,body})=>options.controller.reject(actor,params.id,body),{params,body:object({remark:text})});
