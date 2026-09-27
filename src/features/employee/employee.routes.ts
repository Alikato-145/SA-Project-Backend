import Elysia, { t } from "elysia";
import { createA3TransportAuditPlugin } from "../../core/audit/a3-transport-audit.plugin";
import type { ActionObserver } from "../../core/audit/action-observer";
import { requestIdPlugin } from "../../core/audit/request-id.plugin";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { createEmployeeBankAccountRoutes } from "../employee-bank-account/employee-bank-account.routes";
import type { EmployeeBankAccountService } from "../employee-bank-account/employee-bank-account.service";
import { createEmployeeWeeklyHolidayRoutes } from "../employee-weekly-holiday/employee-weekly-holiday.routes";
import type { EmployeeWeeklyHolidayService } from "../employee-weekly-holiday/employee-weekly-holiday.service";
import { createEmploymentAssignmentRoutes } from "../employment-assignment/employment-assignment.routes";
import type { EmploymentAssignmentService } from "../employment-assignment/employment-assignment.service";
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

const nullableString = t.Union([t.String(), t.Null()]);
const createBody = t.Object({
  employee_code: t.String(), national_id: t.Optional(nullableString), passport_id: t.Optional(nullableString),
  first_name: t.String(), last_name: t.String(), phone: t.Optional(nullableString),
  personal_email: t.Optional(nullableString), address: t.Optional(nullableString), hire_date: t.String(),
}, { additionalProperties: false });
const updateBody = t.Object({
  national_id: t.Optional(nullableString), passport_id: t.Optional(nullableString), first_name: t.Optional(t.String()),
  last_name: t.Optional(t.String()), phone: t.Optional(nullableString), personal_email: t.Optional(nullableString), address: t.Optional(nullableString),
}, { additionalProperties: false });
const statusBody = t.Object({ status: t.String(), terminated_at: t.Optional(nullableString), reason: t.String() }, { additionalProperties: false });
const onboardingBody = t.Object({
  employee: createBody,
  assignment: t.Object({
    branch_id: decimalId,
    department_id: decimalId,
    position_id: decimalId,
    employment_type: t.String(),
    base_salary: t.String(),
    welfare_amount: t.String(),
    effective_from: t.String(),
    effective_to: t.Optional(nullableString),
  }, { additionalProperties: false }),
  bank_account: t.Optional(t.Object({
    bank_code: t.String(),
    bank_name: t.String(),
    account_holder_name: t.String(),
    account_number: t.String(),
    is_primary: t.Optional(t.Boolean()),
  }, { additionalProperties: false })),
  weekly_holidays: t.Optional(t.Array(t.Object({
    weekday: t.Number(),
    effective_from: t.String(),
    effective_to: t.Optional(nullableString),
  }, { additionalProperties: false }))),
  account: t.Optional(t.Object({ username: t.String() }, { additionalProperties: false })),
}, { additionalProperties: false });

export interface EmployeeRoutesOptions {
  service: EmployeeService;
  authenticate(request: Request): Promise<AuthenticatedActor>;
  allowedOrigins: readonly string[];
}

/** Standalone A3 read routes; the A3 bundle will attach transport audit once. */
export const createEmployeeRoutes = (options: EmployeeRoutesOptions) => {
  const controller = createEmployeeController(options.service);
  return new Elysia({ name: "employee-routes", prefix: "/api/v1", normalize: false })
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
    .post("/employees/onboard", ({ actor, body, requestId }) =>
      controller.onboard({ actor, body, requestId }), { body: onboardingBody })
    .post("/employees", ({ actor, body, requestId }) =>
      controller.create({ actor, body, requestId }), { body: createBody })
    .patch("/employees/:employee_id/status", ({ actor, params, body, requestId }) =>
      controller.changeStatus({ actor, employeeId: params.employee_id, body, requestId }), {
        params: t.Object({ employee_id: decimalId }, { additionalProperties: false }), body: statusBody,
      })
    .patch("/employees/:employee_id", ({ actor, params, body, requestId }) =>
      controller.update({ actor, employeeId: params.employee_id, body, requestId }), {
        params: t.Object({ employee_id: decimalId }, { additionalProperties: false }), body: updateBody,
      })
    .get("/employees/:employee_id", ({ actor, params, requestId }) =>
      controller.detail({ actor, employeeId: params.employee_id, requestId }), {
      params: t.Object({ employee_id: decimalId }, { additionalProperties: false }),
    });
};

export interface A3EmployeeRoutesOptions extends EmployeeRoutesOptions {
  actions: ActionObserver;
  assignmentService: EmploymentAssignmentService;
  bankAccountService: EmployeeBankAccountService;
  weeklyHolidayService: EmployeeWeeklyHolidayService;
}

/**
 * Independently composable A3 feature boundary. Person C can mount this bundle
 * once; transport failures are observed once while domain services own outcomes.
 */
export const createA3EmployeeRoutes = (options: A3EmployeeRoutesOptions) =>
  new Elysia({ name: "a3-employee-feature-routes" })
    .use(createA3TransportAuditPlugin(options.actions))
    .use(createEmployeeRoutes(options))
    .use(createEmploymentAssignmentRoutes({
      service: options.assignmentService,
      authenticate: options.authenticate,
      allowedOrigins: options.allowedOrigins,
    }))
    .use(createEmployeeBankAccountRoutes({
      service: options.bankAccountService,
      authenticate: options.authenticate,
      allowedOrigins: options.allowedOrigins,
    }))
    .use(createEmployeeWeeklyHolidayRoutes({
      service: options.weeklyHolidayService,
      authenticate: options.authenticate,
      allowedOrigins: options.allowedOrigins,
    }));
