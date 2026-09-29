import { t } from "elysia";
import { operationTransport, type OperationTransportOptions } from "../../core/middleware/operation-transport";
import { operationId as id, operationDate as date, operationMoney as money } from "../../shared/operation-validation";
const object=(fields:any)=>t.Object(fields,{additionalProperties:false});
const params=object({id});
const employeeQuery=object({employee_id:id});
const text=t.Optional(t.String({maxLength:1000}));
const nullableText=t.Optional(t.Union([t.String({maxLength:1000}),t.Null()]));
import { LoanController } from "./loan.controller";
export const createLoanRoutes=(options:OperationTransportOptions & {controller:LoanController})=> operationTransport("b5-loan",options)

 .get("/loans",({actor,query})=>options.controller.list(actor,query.employee_id),{query:employeeQuery})
 .post("/loans",({actor,body})=>options.controller.create(actor,body),{body:object({employee_id:id,principal_amount:money,installment_count:t.Integer({minimum:1,maximum:5}),first_due_month:date,reason:t.String({minLength:1,maxLength:1000})})});
