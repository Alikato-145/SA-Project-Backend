import Elysia, { t } from "elysia";
import { requestIdPlugin } from "../../core/audit/request-id.plugin";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { validateCookieMutationRequest } from "../../core/auth/csrf-origin";
import { ApplicationError } from "../../core/errors/application.error";
import { toPublicErrorResult } from "../../core/errors/error-boundary";
import { createRoleController } from "./role.controller";
import type { RoleService } from "./role.service";

const decimalId = t.String({ pattern: "^[1-9][0-9]*$", maxLength: 19 });
const roleCode = t.Union([
  t.Literal("EMPLOYEE"), t.Literal("SUPERVISOR"), t.Literal("BRANCH_MANAGER"),
  t.Literal("HR"), t.Literal("OWNER"),
]);
const grantBody = t.Object({
  role_code: roleCode,
  branch_id: t.Optional(t.Union([decimalId, t.Null()])),
  department_id: t.Optional(t.Union([decimalId, t.Null()])),
  reason: t.String({ minLength: 1, maxLength: 500 }),
}, { additionalProperties: false });
const revokeBody = t.Object({ reason: t.String({ minLength: 1, maxLength: 500 }) }, { additionalProperties: false });

export interface RoleRoutesOptions {
  service: RoleService;
  authenticate(request: Request): Promise<AuthenticatedActor>;
  allowedOrigins: readonly string[];
}

/** Composable fixed-role administration routes; the application composer owns registration. */
export const createRoleRoutes = (options: RoleRoutesOptions) => {
  const controller = createRoleController(options.service);
  return new Elysia({ name: "role-administration-routes", prefix: "/api/v1" })
    .use(requestIdPlugin)
    .derive(async ({ request }) => ({ actor: await options.authenticate(request) }))
    .onBeforeHandle(({ request }) => {
      const result = validateCookieMutationRequest(request, options.allowedOrigins);
      if (!result.allowed && result.rejection) throw new ApplicationError(result.rejection);
    })
    .onError(({ code, error, requestId, set }) => {
      const result = toPublicErrorResult(
        code === "VALIDATION"
          ? new ApplicationError("VALIDATION_ERROR")
          : code === "PARSE"
            ? new ApplicationError("MALFORMED_REQUEST")
            : code === "NOT_FOUND"
              ? new ApplicationError("RESOURCE_NOT_FOUND")
              : error,
        requestId,
      );
      set.status = result.status;
      return result.body;
    })
    .get("/roles", ({ actor, requestId }) => controller.list({ actor, requestId }))
    .post("/accounts/:accountId/roles", ({ actor, params, body, requestId }) => controller.grant({ actor, accountId: params.accountId, body, requestId }), {
      params: t.Object({ accountId: decimalId }, { additionalProperties: false }), body: grantBody,
    })
    .delete("/accounts/:accountId/roles/:grantId", ({ actor, params, body, requestId }) => controller.revoke({
      actor, accountId: params.accountId, grantId: params.grantId, reason: body.reason, requestId,
    }), {
      params: t.Object({ accountId: decimalId, grantId: decimalId }, { additionalProperties: false }), body: revokeBody,
    });
};
