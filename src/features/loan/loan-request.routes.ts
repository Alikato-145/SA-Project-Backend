import { t } from "elysia";
import { operationTransport, type OperationTransportOptions } from "../../core/middleware/operation-transport";
import { operationId as id, operationDate as date, operationMoney as money } from "../../shared/operation-validation";
import { LoanRequestController } from "./loan-request.controller";
const object=(fields:any)=>t.Object(fields,{additionalProperties:false});
export const createLoanRequestRoutes=(options:OperationTransportOptions & {controller:LoanRequestController})=>operationTransport("loan-request",options)
 .get("/loan-requests",({actor,query})=>options.controller.list(actor,query.employee_id),{query:object({employee_id:id})})
 .post("/loan-requests",({actor,body})=>options.controller.create(actor,body),{body:object({employee_id:id,principal_amount:money,installment_count:t.Integer({minimum:1,maximum:5}),reason:t.String({minLength:1,maxLength:1000})})})
 .post("/loan-requests/:id/approve",({actor,params,body})=>options.controller.approve(actor,params.id,body),{params:object({id}),body:object({first_due_month:date})})
 .post("/loan-requests/:id/reject",({actor,params,body})=>options.controller.reject(actor,params.id,body),{params:object({id}),body:object({decision_note:t.String({minLength:1,maxLength:1000})})});
