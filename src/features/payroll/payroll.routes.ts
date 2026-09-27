import Elysia, { t } from "elysia";
import { requestIdPlugin } from "../../core/audit/request-id.plugin";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { validateCookieMutationRequest } from "../../core/auth/csrf-origin";
import { ApplicationError } from "../../core/errors/application.error";
import { toPublicErrorResult } from "../../core/errors/error-boundary";
import { createPayrollController, type PayrollControllerService } from "./payroll.controller";

const id = t.String({ pattern: "^[1-9][0-9]*$", maxLength: 19 });
const isoDate = t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
const decimal = t.String({ pattern: "^(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,4})?$" });
const nullableId = t.Optional(t.Union([id, t.Null()]));
const nullableDate = t.Optional(t.Union([isoDate, t.Null()]));
const page = t.Optional(t.Integer({ minimum: 1, maximum: 100000 }));
const pageSize = t.Optional(t.Integer({ minimum: 1, maximum: 100 }));

export interface PayrollRoutesOptions {
  service: PayrollControllerService;
  authenticate(request: Request): Promise<AuthenticatedActor>;
  allowedOrigins: readonly string[];
}

export const createPayrollRoutes = (options: PayrollRoutesOptions) => {
  const controller = createPayrollController(options.service);
  return new Elysia({ name: "payroll-routes", prefix: "/api/v1/payroll", normalize: false })
    .use(requestIdPlugin)
    .derive(async ({ request }) => ({ actor: await options.authenticate(request) }))
    .onBeforeHandle(({ request }) => {
      const result = validateCookieMutationRequest(request, options.allowedOrigins);
      if (!result.allowed && result.rejection) throw new ApplicationError(result.rejection);
    })
    .onError(({ code, error, requestId, set }) => {
      const result = toPublicErrorResult(code === "VALIDATION" ? new ApplicationError("VALIDATION_ERROR") :
        code === "PARSE" ? new ApplicationError("MALFORMED_REQUEST") : error, requestId);
      set.status = result.status;
      return result.body;
    })
    .get("/access", ({ actor, requestId }) => controller.access({ actor, requestId }))
    .get("/configurations", ({ actor, query, requestId }) => controller.listConfigurations({ actor, shopId: query.shop_id, branchId: query.branch_id, configKey: query.config_key, onDate: query.on_date, page: query.page, pageSize: query.page_size, requestId }), {
      query: t.Object({ shop_id: id, branch_id: t.Optional(id), config_key: t.Optional(t.String()), on_date: t.Optional(isoDate), page, page_size: pageSize }, { additionalProperties: false }),
    })
    .post("/configurations", ({ actor, body, requestId }) => controller.createConfiguration({ actor, body, requestId }), {
      body: t.Object({ shop_id: id, branch_id: nullableId, config_key: t.String({ minLength: 1, maxLength: 50 }),
        numeric_value: decimal, unit: t.String({ minLength: 1, maxLength: 30 }), effective_from: isoDate, effective_to: nullableDate }, { additionalProperties: false }),
    })
    .get("/periods", ({ actor, query, requestId }) => controller.listPeriods({ actor, shopId: query.shop_id, year: query.year, status: query.status, page: query.page, pageSize: query.page_size, requestId }), {
      query: t.Object({ shop_id: id, year: t.Optional(t.Integer({ minimum: 2000, maximum: 2200 })), status: t.Optional(t.Union([t.Literal("draft"), t.Literal("previewed"), t.Literal("locked")])), page, page_size: pageSize }, { additionalProperties: false }),
    })
    .post("/periods", ({ actor, body, requestId }) => controller.createPeriod({ actor, body, requestId }), {
      body: t.Object({ shop_id: id, period_year: t.Integer({ minimum: 2000, maximum: 2200 }), period_month: t.Integer({ minimum: 1, maximum: 12 }),
        start_date: isoDate, end_date: isoDate }, { additionalProperties: false }),
    })
    .get("/periods/:period_id", ({ actor, params, requestId }) => controller.period({ actor, periodId: params.period_id, requestId }), {
      params: t.Object({ period_id: id }, { additionalProperties: false }),
    })
    .get("/periods/:period_id/records/:record_id", ({ actor, params, requestId }) => controller.record({ actor, periodId: params.period_id, recordId: params.record_id, requestId }), {
      params: t.Object({ period_id: id, record_id: id }, { additionalProperties: false }),
    })
    .post("/periods/:period_id/preview", ({ actor, params, requestId }) => controller.preview({ actor, periodId: params.period_id, requestId }), {
      params: t.Object({ period_id: id }, { additionalProperties: false }),
    })
    .post("/periods/:period_id/lock", ({ actor, params, requestId }) => controller.lock({ actor, periodId: params.period_id, requestId }), {
      params: t.Object({ period_id: id }, { additionalProperties: false }),
    })
    .get("/adjustments", ({ actor, query, requestId }) => controller.listAdjustments({ actor, recordId: query.record_id, periodId: query.period_id, status: query.status, page: query.page, pageSize: query.page_size, requestId }), {
      query: t.Object({ record_id: t.Optional(id), period_id: t.Optional(id), status: t.Optional(t.Union([t.Literal("pending"), t.Literal("approved"), t.Literal("rejected"), t.Literal("applied")])), page, page_size: pageSize }, { additionalProperties: false }),
    })
    .post("/adjustments", ({ actor, body, requestId }) => controller.requestAdjustment({ actor, body, requestId }), {
      body: t.Object({ original_payroll_record_id: id, applied_payroll_period_id: id,
        direction: t.Union([t.Literal("earning"), t.Literal("deduction")]), amount: decimal,
        reason: t.String({ minLength: 1, maxLength: 1000 }) }, { additionalProperties: false }),
    })
    .post("/adjustments/:adjustment_id/approve", ({ actor, params, requestId }) => controller.decideAdjustment({ actor, adjustmentId: params.adjustment_id, decision: "approved", requestId }), {
      params: t.Object({ adjustment_id: id }, { additionalProperties: false }),
    })
    .post("/adjustments/:adjustment_id/reject", ({ actor, params, requestId }) => controller.decideAdjustment({ actor, adjustmentId: params.adjustment_id, decision: "rejected", requestId }), {
      params: t.Object({ adjustment_id: id }, { additionalProperties: false }),
    });
};
