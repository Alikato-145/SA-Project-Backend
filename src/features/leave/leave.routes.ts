import Elysia, { t } from "elysia";
import type { LeaveActor } from "./leave.dto";
import { LeaveController } from "./leave.controller";

const date = t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
const id = t.Number({ minimum: 1 });
export const createLeaveRoutes = (controller: LeaveController, actorFromContext: (context: unknown) => LeaveActor) =>
  new Elysia({ name: "leave" })
    .get("/leave-requests", (context) =>
      controller.list(actorFromContext(context), context.query.employee_id),
      { query: t.Object({ employee_id: t.Numeric({ minimum: 1 }) }) })
    .post("/leave-requests", (context) =>
      controller.submit(actorFromContext(context), context.body),
      { body: t.Object({
        employee_id: id, leave_type_id: id, start_date: date, end_date: date,
        reason: t.Optional(t.String()), is_retroactive: t.Optional(t.Boolean()),
      }) })
    .post("/leave-requests/:id/approve", (context) =>
      controller.approve(actorFromContext(context), context.params.id, context.body),
      { params: t.Object({ id: t.Numeric({ minimum: 1 }) }),
        body: t.Object({ final_leave_type_id: t.Optional(id) }) })
    .post("/leave-requests/:id/reject", (context) =>
      controller.reject(actorFromContext(context), context.params.id, context.body),
      { params: t.Object({ id: t.Numeric({ minimum: 1 }) }),
        body: t.Object({ remark: t.Optional(t.String()) }) });
