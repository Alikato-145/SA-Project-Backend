import Elysia, { t } from "elysia";
import { requestIdPlugin } from "../../core/audit/request-id.plugin";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { validateCookieMutationRequest } from "../../core/auth/csrf-origin";
import { ApplicationError } from "../../core/errors/application.error";
import { toPublicErrorResult } from "../../core/errors/error-boundary";
import { createPayrollPaymentController, type PayrollPaymentService } from "./payroll-payment.controller";
const id = t.String({ pattern: "^[1-9][0-9]*$", maxLength: 19 });
export const createPayrollPaymentRoutes = (options: {
  service: PayrollPaymentService;
  authenticate(request: Request): Promise<AuthenticatedActor>;
  allowedOrigins: readonly string[];
}) => {
  const controller = createPayrollPaymentController(options.service);
  return new Elysia({ name: "payroll-payment-routes", prefix: "/api/v1/payroll", normalize: false }).use(requestIdPlugin)
    .derive(async ({ request }) => ({ actor: await options.authenticate(request) }))
    .onBeforeHandle(({ request }) => { const result = validateCookieMutationRequest(request, options.allowedOrigins); if (!result.allowed && result.rejection)
    throw new ApplicationError(result.rejection); })
    .onError(({ code, error, requestId, set }) => { const result = toPublicErrorResult(code === "VALIDATION" ? new ApplicationError("VALIDATION_ERROR") : code === "PARSE" ? new ApplicationError("MALFORMED_REQUEST") : error, requestId); set.status = result.status; return result.body; })
    .get("/periods/:period_id/payments", ({ actor, params, query, requestId }) => controller.list({ actor, periodId: params.period_id, branchId: query.branch_id, requestId }), { params: t.Object({ period_id: id }), query: t.Object({ branch_id: t.Optional(id) }, { additionalProperties: false }) })
    .post("/periods/:period_id/payments/prepare", ({ actor, params, query, requestId }) => controller.prepare({ actor, periodId: params.period_id, branchId: query.branch_id, requestId }), { params: t.Object({ period_id: id }), query: t.Object({ branch_id: t.Optional(id) }, { additionalProperties: false }) })
    .get("/payments/:payment_id/qr", ({ actor, params, requestId }) => controller.qr({ actor, paymentId: params.payment_id, requestId }), { params: t.Object({ payment_id: id }) });
};
