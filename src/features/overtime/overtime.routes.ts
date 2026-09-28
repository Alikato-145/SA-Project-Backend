import Elysia, { t } from "elysia";
import type { OvertimeActor } from "./overtime.dto";
import { OvertimeController } from "./overtime.controller";

const id = t.Number({ minimum: 1 });
const params = t.Object({ id: t.Numeric({ minimum: 1 }) });
const remark = t.Object({ remark: t.Optional(t.String()) });
export const createOvertimeRoutes = (controller: OvertimeController, actorFromContext: (context: unknown) => OvertimeActor | Promise<OvertimeActor>) =>
  new Elysia({ name: "overtime" })
    .get("/overtime-records", async (context) =>
      controller.list(await actorFromContext(context), context.query.employee_id),
      { query: t.Object({ employee_id: t.Numeric({ minimum: 1 }) }) })
    .post("/overtime-records", async (context) =>
      controller.submit(await actorFromContext(context), context.body),
      { body: t.Object({
        employee_id: id,
        overtime_date: t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
        overtime_type: t.Union([t.Literal("hourly"), t.Literal("rest_day"), t.Literal("public_holiday")]),
        hours: t.Optional(t.String()), day_units: t.Optional(t.String()),
        work_day_record_id: t.Optional(id), reason: t.Optional(t.String()),
      }) })
    .post("/overtime-records/:id/approve", async (context) =>
      controller.approve(await actorFromContext(context), context.params.id, context.body),
      { params, body: remark })
    .post("/overtime-records/:id/reject", async (context) =>
      controller.reject(await actorFromContext(context), context.params.id, context.body),
      { params, body: remark });
