import Elysia, { t } from "elysia";
import type { LoanActor } from "./loan.dto";
import { LoanController } from "./loan.controller";
export const createLoanRoutes = (controller: LoanController,
  actorFromContext: (context: unknown) => LoanActor) =>
  new Elysia({ name: "loan" })
    .get("/loans", (context) =>
      controller.list(actorFromContext(context), context.query.employee_id),
      { query: t.Object({ employee_id: t.Numeric({ minimum: 1 }) }) })
    .post("/loans", (context) => controller.create(actorFromContext(context), context.body),
      { body: t.Object({
        employee_id: t.Number({ minimum: 1 }),
        principal_amount: t.String({ pattern: "^\\d+(?:\\.\\d{1,2})?$" }),
        installment_count: t.Number({ minimum: 1, maximum: 5 }),
        first_due_month: t.String({ pattern: "^\\d{4}-\\d{2}-01$" }),
        reason: t.String({ minLength: 1 }),
      }) });
