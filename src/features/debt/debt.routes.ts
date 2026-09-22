import Elysia, { t } from "elysia";
import type { DebtActor } from "./debt.dto";
import { DebtController } from "./debt.controller";
export const createDebtRoutes = (controller: DebtController,
  actorFromContext: (context: unknown) => DebtActor) =>
  new Elysia({ name: "debt" })
    .get("/debt-transactions", (context) =>
      controller.list(actorFromContext(context), context.query.employee_id),
      { query: t.Object({ employee_id: t.Numeric({ minimum: 1 }) }) })
    .post("/debt-transactions", (context) =>
      controller.record(actorFromContext(context), context.body),
      { body: t.Object({
        employee_id: t.Number({ minimum: 1 }), debt_type_id: t.Number({ minimum: 1 }),
        transaction_kind: t.Union([t.Literal("charge"), t.Literal("adjustment")]),
        amount: t.String({ pattern: "^\\d+(?:\\.\\d{1,2})?$" }),
        description: t.String({ minLength: 1 }),
      }) })
    .post("/debt-transactions/:id/reverse", (context) =>
      controller.reverse(actorFromContext(context), context.params.id, context.body),
      { params: t.Object({ id: t.Numeric({ minimum: 1 }) }),
        body: t.Object({ description: t.String({ minLength: 1 }) }) });
