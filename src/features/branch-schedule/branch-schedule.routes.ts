import { t } from "elysia";
import { operationTransport, type OperationTransportOptions } from "../../core/middleware/operation-transport";
import { operationId as id, operationDate as date, operationMoney as money } from "../../shared/operation-validation";
const object=(fields:any)=>t.Object(fields,{additionalProperties:false});
const params=object({id});
const employeeQuery=object({employee_id:id});
const text=t.Optional(t.String({maxLength:1000}));
const nullableText=t.Optional(t.Union([t.String({maxLength:1000}),t.Null()]));
import { BranchScheduleController } from "./branch-schedule.controller";

const time=t.String({pattern:"^(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9])?$"});
const fields={work_start_time:time,standard_close_time:time,late_grace_minutes:t.Integer({minimum:0}),effective_from:date,effective_to:t.Optional(t.Union([date,t.Null()]))};
export const createBranchScheduleRoutes=(options:OperationTransportOptions & {controller:BranchScheduleController})=> operationTransport("b5-branch-schedule",options)

 .get("/branch-schedules/applicable",({actor,query})=>options.controller.findApplicable({actor,branchId:query.branch_id,workDate:query.work_date}),{query:object({branch_id:id,work_date:date})})
 .get("/branch-schedules",({actor,query})=>options.controller.list({actor,branchId:query.branch_id,workDate:query.work_date}),{query:object({branch_id:id,work_date:t.Optional(date)})})
 .post("/branch-schedules",({actor,body})=>options.controller.create({actor,command:body}),{body:object({branch_id:id,...fields})})
 .patch("/branch-schedules/:id",({actor,params,body})=>options.controller.update({actor,id:params.id,command:body}),{params,body:object({...Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,t.Optional(value)])),effective_from:date})})
 .put("/branch-schedules/:branch_id/overrides/:date",({actor,params,body})=>options.controller.upsertOverride({actor,branchId:params.branch_id,scheduleDate:params.date,command:body}),{params:object({branch_id:id,date}),body:object({is_closed:t.Boolean(),work_start_time:t.Optional(t.Union([time,t.Null()])),close_time:t.Optional(t.Union([time,t.Null()])),reason:nullableText})});
