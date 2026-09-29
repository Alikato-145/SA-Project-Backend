import Elysia from "elysia";
import type { AuthenticatedActor } from "../auth/auth.types";
import { operationActor } from "../auth/operation-actor";
import { validateCookieMutationRequest } from "../auth/csrf-origin";
import { requestIdPlugin } from "../audit/request-id.plugin";
import { ApplicationError } from "../errors/application.error";
import { toPublicErrorResult } from "../errors/error-boundary";

export interface OperationTransportOptions {
  authenticate(request: Request): Promise<AuthenticatedActor>;
  allowedOrigins: readonly string[];
}
export const operationTransport = (name: string, options: OperationTransportOptions) =>
  new Elysia({ name, prefix: "/api/v1", normalize: false })
    .use(requestIdPlugin)
    .derive(async ({ request, requestId }) => ({ actor: operationActor(await options.authenticate(request), requestId) }))
    .onBeforeHandle(({ request }) => {
      const result = validateCookieMutationRequest(request, options.allowedOrigins);
      if (!result.allowed) throw new ApplicationError(result.rejection!);
    })
    .onError(({ code, error, requestId, set }) => {
      const result = toPublicErrorResult(code === "VALIDATION" ? new ApplicationError("VALIDATION_ERROR")
        : code === "PARSE" ? new ApplicationError("MALFORMED_REQUEST") : error, requestId);
      set.status = result.status;
      return result.body;
    });
