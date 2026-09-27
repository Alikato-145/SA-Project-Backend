import Elysia, { t } from "elysia";
import { requestIdPlugin } from "../../core/audit/request-id.plugin";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { validateCookieMutationRequest } from "../../core/auth/csrf-origin";
import { ApplicationError } from "../../core/errors/application.error";
import { toPublicErrorResult } from "../../core/errors/error-boundary";
import { createUserAccountAdminController } from "./user-account.admin.controller";
import type { UserAccountAdminService } from "./user-account.admin.service";

const decimalId = t.String({ pattern: "^[1-9][0-9]*$", maxLength: 19 });
const reasonBody = t.Object({ reason: t.String({ minLength: 1, maxLength: 500 }) }, { additionalProperties: false });

export interface UserAccountAdminRoutesOptions {
  service: UserAccountAdminService;
  authenticate(request: Request): Promise<AuthenticatedActor>;
  allowedOrigins: readonly string[];
}

export const createUserAccountAdminRoutes = (options: UserAccountAdminRoutesOptions) => {
  const controller = createUserAccountAdminController(options.service);
  return new Elysia({ name: "user-account-administration-routes", prefix: "/api/v1/accounts" })
    .use(requestIdPlugin)
    .derive(async ({ request }) => ({ actor: await options.authenticate(request) }))
    .onBeforeHandle(({ request }) => {
      const result = validateCookieMutationRequest(request, options.allowedOrigins);
      if (!result.allowed && result.rejection) throw new ApplicationError(result.rejection);
    })
    .onError(({ code, error, requestId, set }) => {
      const result = toPublicErrorResult(
        code === "VALIDATION" ? new ApplicationError("VALIDATION_ERROR")
          : code === "PARSE" ? new ApplicationError("MALFORMED_REQUEST")
            : code === "NOT_FOUND" ? new ApplicationError("RESOURCE_NOT_FOUND") : error,
        requestId,
      );
      set.status = result.status;
      return result.body;
    })
    .get("/", ({ actor, requestId, query }) => controller.list({ actor, requestId, query }), {
      query: t.Object({
        page: t.Optional(t.String()), page_size: t.Optional(t.String()), search: t.Optional(t.String({ maxLength: 100 })),
        status: t.Optional(t.Union([t.Literal("active"), t.Literal("locked"), t.Literal("disabled")])),
        role_code: t.Optional(t.Union([t.Literal("EMPLOYEE"), t.Literal("SUPERVISOR"), t.Literal("BRANCH_MANAGER"), t.Literal("HR"), t.Literal("OWNER")])),
        branch_id: t.Optional(decimalId), department_id: t.Optional(decimalId),
      }, { additionalProperties: false }),
    })
    .post("/", ({ actor, requestId, body }) => controller.create({ actor, requestId, body }), {
      body: t.Object({
        username: t.String({ minLength: 3, maxLength: 100 }),
        employee_id: t.Optional(t.Union([decimalId, t.Null()])),
      }, { additionalProperties: false }),
    })
    .get("/:accountId", ({ actor, requestId, params }) => controller.detail({ actor, requestId, accountId: params.accountId }), {
      params: t.Object({ accountId: decimalId }, { additionalProperties: false }),
    })
    .patch("/:accountId/status", ({ actor, requestId, params, body }) => controller.status({ actor, requestId, accountId: params.accountId, body }), {
      params: t.Object({ accountId: decimalId }, { additionalProperties: false }),
      body: t.Object({ status: t.Union([t.Literal("active"), t.Literal("disabled")]), reason: t.String({ minLength: 1, maxLength: 500 }) }, { additionalProperties: false }),
    })
    .post("/:accountId/reset-password", ({ actor, requestId, params, body }) => controller.resetPassword({ actor, requestId, accountId: params.accountId, body }), {
      params: t.Object({ accountId: decimalId }, { additionalProperties: false }), body: reasonBody,
    })
    .post("/:accountId/unlock", ({ actor, requestId, params, body }) => controller.unlock({ actor, requestId, accountId: params.accountId, body }), {
      params: t.Object({ accountId: decimalId }, { additionalProperties: false }), body: reasonBody,
    });
};
