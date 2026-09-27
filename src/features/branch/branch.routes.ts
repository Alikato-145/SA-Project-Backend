import Elysia, { t } from "elysia";
import { requestIdPlugin } from "../../core/audit/request-id.plugin";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { validateCookieMutationRequest } from "../../core/auth/csrf-origin";
import { ApplicationError } from "../../core/errors/application.error";
import { toPublicErrorResult } from "../../core/errors/error-boundary";
import { createBranchController } from "./branch.controller";
import type { BranchService } from "./branch.service";

const decimalId = t.String({ pattern: "^[1-9][0-9]*$", maxLength: 19 });
const listQuery = t.Object(
  {
    page: t.Optional(t.String({ pattern: "^[1-9][0-9]*$" })),
    page_size: t.Optional(t.String({ pattern: "^[1-9][0-9]*$" })),
    search: t.Optional(t.String({ minLength: 1, maxLength: 150 })),
    is_active: t.Optional(t.Union([t.Literal("true"), t.Literal("false")])),
    shop_id: t.Optional(decimalId),
  },
  { additionalProperties: false },
);
const createBody = t.Object(
  {
    shop_id: decimalId,
    code: t.String({ minLength: 1, maxLength: 30 }),
    name: t.String({ minLength: 1, maxLength: 150 }),
    address: t.Optional(t.Union([t.String({ maxLength: 500 }), t.Null()])),
    timezone: t.Optional(t.String({ minLength: 1, maxLength: 50 })),
  },
  { additionalProperties: false },
);
const updateBody = t.Object(
  {
    // Kept in the schema only so the DTO parser can return the stable
    // immutable-parent validation error instead of silently stripping it.
    shop_id: t.Optional(decimalId),
    code: t.Optional(t.String({ minLength: 1, maxLength: 30 })),
    name: t.Optional(t.String({ minLength: 1, maxLength: 150 })),
    address: t.Optional(t.Union([t.String({ maxLength: 500 }), t.Null()])),
    timezone: t.Optional(t.String({ minLength: 1, maxLength: 50 })),
  },
  { additionalProperties: false, minProperties: 1 },
);
const deactivateBody = t.Object(
  { reason: t.String({ minLength: 1, maxLength: 500 }) },
  { additionalProperties: false },
);

export interface BranchRoutesOptions {
  service: BranchService;
  authenticate(request: Request): Promise<AuthenticatedActor>;
  allowedOrigins: readonly string[];
}

/** Composable read-only branch routes; shared application composition stays external. */
export const createBranchRoutes = (options: BranchRoutesOptions) => {
  const controller = createBranchController(options.service);
  return new Elysia({
    name: "branch-routes",
    prefix: "/api/v1",
    normalize: false,
  })
    .use(requestIdPlugin)
    .derive(async ({ request }) => ({
      actor: await options.authenticate(request),
    }))
    .onBeforeHandle(({ request }) => {
      const result = validateCookieMutationRequest(
        request,
        options.allowedOrigins,
      );
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
    .get(
      "/branches",
      ({ actor, query, requestId }) =>
        controller.list({ actor, query, requestId }),
      { query: listQuery },
    )
    .get(
      "/branches/:branch_id",
      ({ actor, params, requestId }) =>
        controller.detail({
          actor,
          branchId: params.branch_id,
          requestId,
        }),
      {
        params: t.Object(
          { branch_id: decimalId },
          { additionalProperties: false },
        ),
      },
    )
    .post(
      "/branches",
      ({ actor, body, requestId }) =>
        controller.create({ actor, body, requestId }),
      { body: createBody },
    )
    .patch(
      "/branches/:branch_id",
      ({ actor, body, params, requestId }) =>
        controller.update({
          actor,
          body,
          branchId: params.branch_id,
          requestId,
        }),
      {
        params: t.Object(
          { branch_id: decimalId },
          { additionalProperties: false },
        ),
        body: updateBody,
      },
    )
    .post(
      "/branches/:branch_id/deactivate",
      ({ actor, body, params, requestId }) =>
        controller.deactivate({
          actor,
          body,
          branchId: params.branch_id,
          requestId,
        }),
      {
        params: t.Object(
          { branch_id: decimalId },
          { additionalProperties: false },
        ),
        body: deactivateBody,
      },
    );
};
