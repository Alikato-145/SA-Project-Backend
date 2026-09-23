import Elysia, { t } from "elysia";
import { requestIdPlugin } from "../../core/audit/request-id.plugin";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { validateCookieMutationRequest } from "../../core/auth/csrf-origin";
import { ApplicationError } from "../../core/errors/application.error";
import { toPublicErrorResult } from "../../core/errors/error-boundary";
import { createDepartmentController } from "./department.controller";
import type { DepartmentService } from "./department.service";

const decimalId = t.String({ pattern: "^[1-9][0-9]*$", maxLength: 19 });
const listQuery = t.Object({
  page: t.Optional(t.String()),
  page_size: t.Optional(t.String()),
  search: t.Optional(t.String()),
  is_active: t.Optional(t.Union([t.Literal("true"), t.Literal("false")])),
  branch_id: t.Optional(decimalId),
}, { additionalProperties: false });
const createBody = t.Object({
  branch_id: decimalId,
  code: t.String({ minLength: 1, maxLength: 30 }),
  name: t.String({ minLength: 1, maxLength: 100 }),
}, { additionalProperties: false });
const updateBody = t.Object({
  // Accepted by the transport only so the DTO parser emits the stable
  // immutable-parent validation response instead of silently dropping it.
  branch_id: t.Optional(decimalId),
  code: t.Optional(t.String({ minLength: 1, maxLength: 30 })),
  name: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
}, { additionalProperties: false, minProperties: 1 });
const deactivateBody = t.Object({
  reason: t.String({ minLength: 1, maxLength: 500 }),
}, { additionalProperties: false });

export interface DepartmentRoutesOptions {
  service: DepartmentService;
  authenticate(request: Request): Promise<AuthenticatedActor>;
  allowedOrigins: readonly string[];
}

/** Composable Department routes; the application composer owns registration. */
export const createDepartmentRoutes = (options: DepartmentRoutesOptions) => {
  const controller = createDepartmentController(options.service);
  return new Elysia({
    name: "department-read-routes",
    prefix: "/api/v1",
    normalize: false,
  })
    .use(requestIdPlugin)
    .derive(async ({ request }) => ({ actor: await options.authenticate(request) }))
    .onBeforeHandle(({ request }) => {
      const result = validateCookieMutationRequest(request, options.allowedOrigins);
      if (!result.allowed && result.rejection) {
        throw new ApplicationError(result.rejection);
      }
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
    .get("/departments", ({ actor, query, requestId }) =>
      controller.list({ actor, query, requestId }), { query: listQuery })
    .get("/departments/:department_id", ({ actor, params, requestId }) =>
      controller.detail({
        actor,
        departmentId: params.department_id,
        requestId,
      }), {
      params: t.Object({ department_id: decimalId }, { additionalProperties: false }),
    })
    .post("/departments", ({ actor, body, requestId }) =>
      controller.create({ actor, body, requestId }), { body: createBody })
    .patch("/departments/:department_id", ({ actor, body, params, requestId }) =>
      controller.update({
        actor,
        body,
        departmentId: params.department_id,
        requestId,
      }), {
      params: t.Object({ department_id: decimalId }, { additionalProperties: false }),
      body: updateBody,
    })
    .post("/departments/:department_id/deactivate", ({ actor, body, params, requestId }) =>
      controller.deactivate({
        actor,
        body,
        departmentId: params.department_id,
        requestId,
      }), {
      params: t.Object({ department_id: decimalId }, { additionalProperties: false }),
      body: deactivateBody,
    });
};
