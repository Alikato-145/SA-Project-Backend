import Elysia, { t } from "elysia";
import { requestIdPlugin } from "../../core/audit/request-id.plugin";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { validateCookieMutationRequest } from "../../core/auth/csrf-origin";
import { ApplicationError } from "../../core/errors/application.error";
import { toPublicErrorResult } from "../../core/errors/error-boundary";
import { createPositionController } from "./position.controller";
import type { PositionService } from "./position.service";

const decimalId = t.String({ pattern: "^[1-9][0-9]*$", maxLength: 16 });
const listQuery = t.Object(
  {
    page: t.Optional(t.String()),
    page_size: t.Optional(t.String()),
    search: t.Optional(t.String()),
    is_active: t.Optional(t.Union([t.Literal("true"), t.Literal("false")])),
    shop_id: t.Optional(decimalId),
  },
  { additionalProperties: false },
);
const createBody = t.Object(
  {
    shop_id: decimalId,
    code: t.String({ minLength: 1, maxLength: 30 }),
    name: t.String({ minLength: 1, maxLength: 100 }),
  },
  { additionalProperties: false },
);
const updateBody = t.Object(
  {
    // Accepted by the schema only so the DTO layer emits the explicit,
    // stable immutable-parent validation error.
    shop_id: t.Optional(decimalId),
    code: t.Optional(t.String({ minLength: 1, maxLength: 30 })),
    name: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  },
  { additionalProperties: false, minProperties: 1 },
);
const deactivateBody = t.Object(
  { reason: t.String({ minLength: 1, maxLength: 500 }) },
  { additionalProperties: false },
);

export interface PositionRoutesOptions {
  service: PositionService;
  authenticate(request: Request): Promise<AuthenticatedActor>;
  allowedOrigins?: readonly string[];
}

/** Composable Position reads; the A2 bundle owns transport-failure auditing. */
export const createPositionRoutes = (options: PositionRoutesOptions) => {
  const controller = createPositionController(options.service);
  return new Elysia({
    name: "position-read-routes",
    prefix: "/api/v1",
    normalize: false,
  })
    .use(requestIdPlugin)
    .derive(async ({ request }) => ({ actor: await options.authenticate(request) }))
    .onBeforeHandle(({ request }) => {
      const result = validateCookieMutationRequest(
        request,
        options.allowedOrigins ?? [],
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
      "/positions",
      ({ actor, requestId, query }) =>
        controller.list({ actor, requestId, query }),
      { query: listQuery },
    )
    .get(
      "/positions/:position_id",
      ({ actor, requestId, params }) =>
        controller.detail({
          actor,
          requestId,
          positionId: params.position_id,
        }),
      {
        params: t.Object(
          { position_id: decimalId },
          { additionalProperties: false },
        ),
      },
    )
    .post(
      "/positions",
      ({ actor, body, requestId }) =>
        controller.create({ actor, body, requestId }),
      { body: createBody },
    )
    .patch(
      "/positions/:position_id",
      ({ actor, body, params, requestId }) =>
        controller.update({
          actor,
          body,
          positionId: params.position_id,
          requestId,
        }),
      {
        params: t.Object(
          { position_id: decimalId },
          { additionalProperties: false },
        ),
        body: updateBody,
      },
    )
    .post(
      "/positions/:position_id/deactivate",
      ({ actor, body, params, requestId }) =>
        controller.deactivate({
          actor,
          body,
          positionId: params.position_id,
          requestId,
        }),
      {
        params: t.Object(
          { position_id: decimalId },
          { additionalProperties: false },
        ),
        body: deactivateBody,
      },
    );
};
