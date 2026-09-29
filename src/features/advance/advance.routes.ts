import { t } from "elysia";
import { operationTransport, type OperationTransportOptions } from "../../core/middleware/operation-transport";
import { operationId as id, operationDate as date, operationMoney as money } from "../../shared/operation-validation";
const object=(fields:any)=>t.Object(fields,{additionalProperties:false});
const params=object({id});
const employeeQuery=object({employee_id:id});
const text=t.Optional(t.String({maxLength:1000}));
const nullableText=t.Optional(t.Union([t.String({maxLength:1000}),t.Null()]));
import { AdvanceController } from "./advance.controller";
export const createAdvanceRoutes=(options:OperationTransportOptions & {controller:AdvanceController})=> operationTransport("b5-advance",options)

 .get("/advance-requests",({actor,query})=>options.controller.list(actor,query.employee_id),{query:employeeQuery})
 .post("/advance-requests",({actor,body})=>options.controller.submit(actor,body),{body:object({employee_id:id,amount:money})})
 .post("/advance-requests/:id/approve",({actor,params})=>options.controller.approve(actor,params.id),{params})
 .post("/advance-requests/:id/reject",({actor,params,body})=>options.controller.reject(actor,params.id,body),{params,body:object({note:text})});
