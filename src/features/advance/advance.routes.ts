import Elysia, { t } from "elysia";
import type { AdvanceActor } from "./advance.dto";
import { AdvanceController } from "./advance.controller";
const id = t.Number({ minimum: 1 });
export const createAdvanceRoutes = (controller: AdvanceController,
  actorFromContext: (context: unknown) => AdvanceActor | Promise<AdvanceActor>) =>
  new Elysia({ name: "advance" })
    .get("/advance-requests", async (context) =>
      controller.list(await actorFromContext(context), context.query.employee_id),
      { query: t.Object({ employee_id: t.Numeric({ minimum: 1 }) }) })
    .post("/advance-requests", async (context) =>
      controller.submit(await actorFromContext(context), context.body),
      { body: t.Object({ employee_id: id, amount: t.String({ pattern: "^\\d+(?:\\.\\d{1,2})?$" }) }) })
    .post("/advance-requests/:id/approve", async (context) =>
      controller.approve(await actorFromContext(context), context.params.id),
      { params: t.Object({ id: t.Numeric({ minimum: 1 }) }) })
    .post("/advance-requests/:id/reject", async (context) =>
      controller.reject(await actorFromContext(context), context.params.id, context.body),
      { params: t.Object({ id: t.Numeric({ minimum: 1 }) }),
        body: t.Object({ note: t.Optional(t.String()) }) });
