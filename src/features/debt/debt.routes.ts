import { t } from "elysia";
import { operationTransport, type OperationTransportOptions } from "../../core/middleware/operation-transport";
import { operationId as id, operationDate as date, operationMoney as money } from "../../shared/operation-validation";
const object=(fields:any)=>t.Object(fields,{additionalProperties:false});
const params=object({id});
const employeeQuery=object({employee_id:id});
const text=t.Optional(t.String({maxLength:1000}));
const nullableText=t.Optional(t.Union([t.String({maxLength:1000}),t.Null()]));
import { DebtController } from "./debt.controller";
export const createDebtRoutes=(options:OperationTransportOptions & {controller:DebtController})=> operationTransport("b5-debt",options)

 .get("/debt-transactions",({actor,query})=>options.controller.list(actor,query.employee_id),{query:employeeQuery})
 .post("/debt-transactions",({actor,body})=>options.controller.record(actor,body),{body:object({employee_id:id,debt_type_id:id,transaction_kind:t.Union([t.Literal("charge"),t.Literal("adjustment")]),amount:money,description:t.String({minLength:1,maxLength:1000})})})
 .post("/debt-transactions/:id/reverse",({actor,params,body})=>options.controller.reverse(actor,params.id,body),{params,body:object({description:t.String({minLength:1,maxLength:1000})})});
