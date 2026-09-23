import Elysia, { t } from "elysia";
import { requestIdPlugin } from "../../core/audit/request-id.plugin";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { validateCookieMutationRequest } from "../../core/auth/csrf-origin";
import { ApplicationError } from "../../core/errors/application.error";
import { toPublicErrorResult } from "../../core/errors/error-boundary";
import { createShopController } from "./shop.controller";
import type { ShopService } from "./shop.service";

const decimalId = t.String({ pattern: "^[1-9][0-9]*$", maxLength: 16 });
const listQuery = t.Object({
  page: t.Optional(t.String()),
  page_size: t.Optional(t.String()),
  search: t.Optional(t.String({ maxLength: 150 })),
  is_active: t.Optional(t.String()),
}, { additionalProperties: false });
const createBody = t.Object({
  code: t.String({ minLength: 1, maxLength: 30 }),
  name: t.String({ minLength: 1, maxLength: 150 }),
}, { additionalProperties: false });
const updateBody = t.Object({
  code: t.Optional(t.String({ minLength: 1, maxLength: 30 })),
  name: t.Optional(t.String({ minLength: 1, maxLength: 150 })),
}, { additionalProperties: false, minProperties: 1 });
const deactivateBody = t.Object({
  reason: t.String({ minLength: 1, maxLength: 500 }),
}, { additionalProperties: false });

export interface ShopRoutesOptions {
  service: ShopService;
  authenticate(request: Request): Promise<AuthenticatedActor>;
  allowedOrigins: readonly string[];
}

export const createShopRoutes = (options: ShopRoutesOptions) => {
  const controller = createShopController(options.service);
  return new Elysia({
    name: "shop-read-routes",
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
    .get("/shops", ({ actor, query, requestId }) =>
      controller.list({ actor, query, requestId }), { query: listQuery })
    .get("/shops/:shopId", ({ actor, params, requestId }) =>
      controller.detail({ actor, shopId: params.shopId, requestId }), {
      params: t.Object({ shopId: decimalId }, { additionalProperties: false }),
    })
    .post("/shops", ({ actor, body, requestId }) =>
      controller.create({ actor, body, requestId }), { body: createBody })
    .patch("/shops/:shopId", ({ actor, params, body, requestId }) =>
      controller.update({
        actor,
        shopId: params.shopId,
        body,
        requestId,
      }), {
      params: t.Object({ shopId: decimalId }, { additionalProperties: false }),
      body: updateBody,
    })
    .post("/shops/:shopId/deactivate", ({ actor, params, body, requestId }) =>
      controller.deactivate({
        actor,
        shopId: params.shopId,
        body,
        requestId,
      }), {
      params: t.Object({ shopId: decimalId }, { additionalProperties: false }),
      body: deactivateBody,
    });
};
