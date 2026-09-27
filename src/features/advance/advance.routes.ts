import Elysia, { t } from "elysia";
import type { AdvanceActor } from "./advance.dto";
import { AdvanceController } from "./advance.controller";
const id = t.Number({ minimum: 1 });
export const createAdvanceRoutes = (controller: AdvanceController,
  actorFromContext: (context: unknown) => AdvanceActor) =>
  new Elysia({ name: "advance" })
    .get("/advance-requests", (context) =>
      controller.list(actorFromContext(context), context.query.employee_id),
      { query: t.Object({ employee_id: t.Numeric({ minimum: 1 }) }) })
    .post("/advance-requests", (context) =>
      controller.submit(actorFromContext(context), context.body),
      { body: t.Object({ employee_id: id, amount: t.String({ pattern: "^\\d+(?:\\.\\d{1,2})?$" }) }) })
    .post("/advance-requests/:id/approve", (context) =>
      controller.approve(actorFromContext(context), context.params.id),
      { params: t.Object({ id: t.Numeric({ minimum: 1 }) }) })
    .post("/advance-requests/:id/reject", (context) =>
      controller.reject(actorFromContext(context), context.params.id, context.body),
      { params: t.Object({ id: t.Numeric({ minimum: 1 }) }),
        body: t.Object({ note: t.Optional(t.String()) }) });
