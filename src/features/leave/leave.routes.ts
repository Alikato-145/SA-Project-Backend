import { t } from "elysia";
import { operationTransport, type OperationTransportOptions } from "../../core/middleware/operation-transport";
import { operationId as id, operationDate as date, operationMoney as money } from "../../shared/operation-validation";
const object=(fields:any)=>t.Object(fields,{additionalProperties:false});
const params=object({id});
const employeeQuery=object({employee_id:id});
const text=t.Optional(t.String({maxLength:1000}));
const nullableText=t.Optional(t.Union([t.String({maxLength:1000}),t.Null()]));
import { LeaveController } from "./leave.controller";
export const createLeaveRoutes=(options:OperationTransportOptions & {controller:LeaveController})=> operationTransport("b5-leave",options)

 .get("/leave-types",({actor})=>options.controller.types(actor))
 .get("/leave-quotas",({actor,query})=>options.controller.quotas(actor,query.employee_id,query.quota_year),{query:object({employee_id:id,quota_year:t.String({pattern:"^[0-9]{4}$"})})})
 .get("/leave-requests/:id/history",({actor,params})=>options.controller.history(actor,params.id),{params})
 .get("/leave-requests",({actor,query})=>options.controller.list(actor,query.employee_id),{query:employeeQuery})
 .post("/leave-requests",({actor,body})=>options.controller.submit(actor,body),{body:object({employee_id:id,leave_type_id:id,start_date:date,end_date:date,reason:text,is_retroactive:t.Optional(t.Boolean())})})
 .post("/leave-requests/:id/approve",({actor,params,body})=>options.controller.approve(actor,params.id,body),{params,body:object({final_leave_type_id:t.Optional(id)})})
 .post("/leave-requests/:id/reject",({actor,params,body})=>options.controller.reject(actor,params.id,body),{params,body:object({remark:text})});
