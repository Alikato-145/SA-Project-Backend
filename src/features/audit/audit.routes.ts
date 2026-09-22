import Elysia from "elysia";
import { requestIdPlugin } from "../../core/audit/request-id.plugin";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { ApplicationError } from "../../core/errors/application.error";
import { toPublicErrorResult } from "../../core/errors/error-boundary";
import { createAuditController } from "./audit.controller";
import type { AuditService } from "./audit.service";

export interface AuditRoutesOptions {
  service: AuditService;
  /** Authentication adapter supplied by the application composition root. */
  authenticate(request: Request): Promise<AuthenticatedActor>;
}

/** Exported, composable read-only audit-history routes. */
export const createAuditRoutes = (options: AuditRoutesOptions) => {
  const controller = createAuditController(options.service);

  return new Elysia({
    name: "audit-history-routes",
    prefix: "/api/v1/audit-logs",
  })
    .use(requestIdPlugin)
    .onError(({ code, error, requestId, set }) => {
      const publicError = toPublicErrorResult(
        code === "VALIDATION"
          ? new ApplicationError("VALIDATION_ERROR")
          : code === "PARSE"
            ? new ApplicationError("MALFORMED_REQUEST")
            : error,
        requestId,
      );
      set.status = publicError.status;
      return publicError.body;
    })
    .get("/", async ({ query, request, requestId }) => {
      const actor = await options.authenticate(request);
      return controller.list({ actor, requestId, query });
    });
};
