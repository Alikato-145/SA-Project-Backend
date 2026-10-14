import { t } from "elysia";
import { operationTransport, type OperationTransportOptions } from "../../core/middleware/operation-transport";
import { operationId as id, operationDate as date, operationMoney as money } from "../../shared/operation-validation";
const object=(fields:any)=>t.Object(fields,{additionalProperties:false});
const params=object({id});
const employeeQuery=object({employee_id:id});
const text=t.Optional(t.String({maxLength:1000}));
const nullableText=t.Optional(t.Union([t.String({maxLength:1000}),t.Null()]));
const typeBody=object({code:t.String({pattern:"^[A-Z][A-Z0-9_]{0,29}$"}),name_th:t.String({minLength:1,maxLength:100}),quota_type:t.Union([t.Literal("fixed"),t.Literal("by_seniority"),t.Literal("none")]),quota_days:t.Union([money,t.Null()]),is_deductible:t.Boolean(),requires_document:t.Boolean(),allow_exceed:t.Boolean(),is_active:t.Boolean()});
import { LeaveController } from "./leave.controller";
export const createLeaveRoutes=(options:OperationTransportOptions & {controller:LeaveController})=> operationTransport("b5-leave",options)

 .get("/leave-types",({actor})=>options.controller.types(actor))
 .get("/leave-types/manage",({actor})=>options.controller.managedTypes(actor))
 .post("/leave-types",({actor,body})=>options.controller.saveType(actor,body),{body:typeBody})
 .patch("/leave-types/:id",({actor,params,body})=>options.controller.saveType(actor,body,params.id),{params,body:typeBody})
 .put("/leave-quotas",({actor,body})=>options.controller.setQuota(actor,body),{body:object({employee_id:id,leave_type_id:id,quota_year:t.Integer({minimum:2000,maximum:2200}),entitled_days:money})})
 .get("/leave-quotas",({actor,query})=>options.controller.quotas(actor,query.employee_id,query.quota_year),{query:object({employee_id:id,quota_year:t.String({pattern:"^[0-9]{4}$"})})})
 .get("/leave-requests/:id/history",({actor,params})=>options.controller.history(actor,params.id),{params})
 .get("/leave-requests",({actor,query})=>options.controller.list(actor,query.employee_id),{query:employeeQuery})
 .post("/leave-requests",({actor,body})=>options.controller.submit(actor,body),{body:object({employee_id:id,leave_type_id:id,start_date:date,end_date:date,reason:text,is_retroactive:t.Optional(t.Boolean())})})
 .patch("/leave-requests/:id",({actor,params,body})=>options.controller.update(actor,params.id,body),{params,body:object({leave_type_id:id,start_date:date,end_date:date,reason:text,is_retroactive:t.Optional(t.Boolean())})})
 .post("/leave-requests/:id/approve",({actor,params,body})=>options.controller.approve(actor,params.id,body),{params,body:object({final_leave_type_id:t.Optional(id),remark:text})})
 .post("/leave-requests/:id/reject",({actor,params,body})=>options.controller.reject(actor,params.id,body),{params,body:object({remark:text})});
