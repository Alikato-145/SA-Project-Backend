import { t } from "elysia";
import { operationTransport, type OperationTransportOptions } from "../../core/middleware/operation-transport";
import { operationId as id, operationMoney as money } from "../../shared/operation-validation";
const object=(fields:any)=>t.Object(fields,{additionalProperties:false});
const params=object({id});
const employeeQuery=object({employee_id:id});
const text=t.String({minLength:1,maxLength:1000});
import { AdvanceController } from "./advance.controller";
export const createAdvanceRoutes=(options:OperationTransportOptions & {controller:AdvanceController})=> operationTransport("b5-advance",options)

 .get("/advance-requests",({actor,query})=>options.controller.list(actor,query.employee_id),{query:employeeQuery})
 .post("/advance-requests",({actor,body})=>options.controller.submit(actor,body),{body:object({employee_id:id,amount:money,reason:text})})
 .post("/advance-requests/:id/approve",({actor,params})=>options.controller.approve(actor,params.id),{params})
 .post("/advance-requests/:id/reject",({actor,params,body})=>options.controller.reject(actor,params.id,body),{params,body:object({note:text})});
