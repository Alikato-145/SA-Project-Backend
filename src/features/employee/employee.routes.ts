import Elysia, { t } from "elysia";
import { requestIdPlugin } from "../../core/audit/request-id.plugin";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { validateCookieMutationRequest } from "../../core/auth/csrf-origin";
import { ApplicationError } from "../../core/errors/application.error";
import { toPublicErrorResult } from "../../core/errors/error-boundary";
import { createEmployeeController } from "./employee.controller";
import type { EmployeeService } from "./employee.service";

const decimalId = t.String({ pattern: "^[1-9][0-9]*$", maxLength: 16 });
const listQuery = t.Object({
  page: t.Optional(t.String()), page_size: t.Optional(t.String()),
  search: t.Optional(t.String({ maxLength: 150 })),
  status: t.Optional(t.String()), branch_id: t.Optional(t.String()), department_id: t.Optional(t.String()),
}, { additionalProperties: false });

export interface EmployeeRoutesOptions {
  service: EmployeeService;
  authenticate(request: Request): Promise<AuthenticatedActor>;
  allowedOrigins: readonly string[];
}

/** Standalone A3 read routes; the A3 bundle will attach transport audit once. */
export const createEmployeeRoutes = (options: EmployeeRoutesOptions) => {
  const controller = createEmployeeController(options.service);
  return new Elysia({ name: "employee-read-routes", prefix: "/api/v1", normalize: false })
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
    .get("/employees", ({ actor, query, requestId }) =>
      controller.list({ actor, query, requestId }), { query: listQuery })
    .get("/employees/:employee_id", ({ actor, params, requestId }) =>
      controller.detail({ actor, employeeId: params.employee_id, requestId }), {
      params: t.Object({ employee_id: decimalId }, { additionalProperties: false }),
    });
};
