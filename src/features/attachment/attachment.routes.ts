import Elysia, { t } from "elysia";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { requestIdPlugin } from "../../core/audit/request-id.plugin";
import { validateCookieMutationRequest } from "../../core/auth/csrf-origin";
import { ApplicationError } from "../../core/errors/application.error";
import { toPublicErrorResult } from "../../core/errors/error-boundary";
import type { AttachmentService } from "./attachment.service";
import { createAttachmentController } from "./attachment.controller";
export const createAttachmentRoutes = (options: { service: AttachmentService; authenticate(request: Request): Promise<AuthenticatedActor>; allowedOrigins: readonly string[] }) => {
  const controller = createAttachmentController(options.service), id = t.String({ pattern: "^[1-9][0-9]*$", maxLength: 16 });
  return new Elysia({ name: "attachment-routes", prefix: "/api/v1" }).use(requestIdPlugin)
    .derive(async ({ request }) => ({ actor: await options.authenticate(request) }))
    .onBeforeHandle(({ request }) => { const result = validateCookieMutationRequest(request, options.allowedOrigins, ["multipart/form-data"]); if (!result.allowed) throw new ApplicationError(result.rejection!); })
    .onError(({ code, error, requestId, set }) => { const result = toPublicErrorResult(code === "VALIDATION" ? new ApplicationError("VALIDATION_ERROR") : error, requestId); set.status = result.status; return result.body; })
    .get("/employees/:employee_id/attachments", ({ actor, params, requestId }) => controller.list(actor, { kind: "employee", id: params.employee_id }, requestId), { params: t.Object({ employee_id: id }) })
    .post("/employees/:employee_id/attachments", ({ actor, params, body, requestId }) => controller.upload(actor, { kind: "employee", id: params.employee_id }, body.file, requestId), { params: t.Object({ employee_id: id }), body: t.Object({ file: t.File({ maxSize: "5m" }) }) })
    .get("/leave-requests/:id/attachments", ({ actor, params, requestId }) => controller.list(actor, { kind: "leave", id: params.id }, requestId), { params: t.Object({ id }) })
    .post("/leave-requests/:id/attachments", ({ actor, params, body, requestId }) => controller.upload(actor, { kind: "leave", id: params.id }, body.file, requestId), { params: t.Object({ id }), body: t.Object({ file: t.File({ maxSize: "5m" }) }) })
    .get("/attachments/:id/download", ({ actor, params, requestId }) => controller.download(actor, params.id, requestId), { params: t.Object({ id }) });
};
