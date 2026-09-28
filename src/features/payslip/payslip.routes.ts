import Elysia, { t } from "elysia";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { requestIdPlugin } from "../../core/audit/request-id.plugin";
import { validateCookieMutationRequest } from "../../core/auth/csrf-origin";
import { ApplicationError } from "../../core/errors/application.error";
import { toPublicErrorResult } from "../../core/errors/error-boundary";
import { createPayslipController } from "./payslip.controller";
import type { PayslipService } from "./payslip.service";
const id = t.String({ pattern: "^[1-9][0-9]*$", maxLength: 19 });
export const createPayslipRoutes = (options: { service: PayslipService; authenticate(request: Request): Promise<AuthenticatedActor>; allowedOrigins: readonly string[] }) => {
  const controller = createPayslipController(options.service);
  return new Elysia({ name: "payslip-routes", prefix: "/api/v1/payslips", normalize: false }).use(requestIdPlugin).derive(async ({ request }) => ({ actor: await options.authenticate(request) })).onBeforeHandle(({ request }) => { const check = validateCookieMutationRequest(request, options.allowedOrigins); if (!check.allowed && check.rejection) throw new ApplicationError(check.rejection); }).onError(({ code, error, requestId, set }) => { const result = toPublicErrorResult(code === "VALIDATION" ? new ApplicationError("VALIDATION_ERROR") : error, requestId); set.status = result.status; return result.body; })
    .post("/payroll-records/:record_id", ({ actor, params, requestId }) => controller.generate({ actor, recordId: params.record_id, requestId }), { params: t.Object({ record_id: id }) })
    .get("/mine", ({ actor, requestId }) => controller.mine({ actor, requestId }))
    .get("/:id", ({ actor, params, requestId }) => controller.get({ actor, payslipId: params.id, requestId }), { params: t.Object({ id }) })
    .get("/:id/deliveries", ({ actor, params, requestId }) => controller.deliveries({ actor, payslipId: params.id, requestId }), { params: t.Object({ id }) })
    .post("/:id/deliveries", ({ actor, params, body, requestId }) => controller.deliver({ actor, payslipId: params.id, email: body.recipient_email, requestId }), { params: t.Object({ id }), body: t.Object({ recipient_email: t.String({ maxLength: 255 }) }) })
    .post("/:id/void", ({ actor, params, requestId }) => controller.void({ actor, payslipId: params.id, requestId }), { params: t.Object({ id }) });
};
