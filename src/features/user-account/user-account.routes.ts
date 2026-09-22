import Elysia from "elysia";
import { requestIdPlugin } from "../../core/audit/request-id.plugin";
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
} from "../../core/auth/auth.types";
import { validateCookieMutationRequest } from "../../core/auth/csrf-origin";
import { createSessionCookieOptions } from "../../core/auth/session-token";
import { ApplicationError } from "../../core/errors/application.error";
import { toPublicErrorResult } from "../../core/errors/error-boundary";
import {
  createUserAccountController,
  type UserAccountService,
} from "./user-account.controller";
import { loginRequestSchema } from "./user-account.validation";

export interface UserAccountRoutesOptions {
  service: UserAccountService;
  allowedOrigins: readonly string[];
  secureCookies: boolean;
  sessionTtlSeconds?: number;
}

const sessionValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/** Composable A1 authentication routes. The application composer owns registration. */
export const createUserAccountRoutes = (options: UserAccountRoutesOptions) => {
  const controller = createUserAccountController(options.service);
  const maxAge = options.sessionTtlSeconds ?? SESSION_TTL_SECONDS;

  return new Elysia({ name: "user-account-auth-routes", prefix: "/api/v1/auth" })
    .use(requestIdPlugin)
    .onBeforeHandle(({ request }) => {
      const validation = validateCookieMutationRequest(
        request,
        options.allowedOrigins,
      );
      if (!validation.allowed && validation.rejection) {
        throw new ApplicationError(validation.rejection);
      }
    })
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
    .post(
      "/login",
      async ({ body, cookie, requestId }) => {
        const result = await controller.login({ body, requestId });
        cookie[SESSION_COOKIE_NAME].set(
          createSessionCookieOptions(
            result.token,
            options.secureCookies,
            maxAge,
          ),
        );
        return result.body;
      },
      { body: loginRequestSchema },
    )
    .post("/logout", async ({ cookie, requestId }) => {
      const authCookie = cookie[SESSION_COOKIE_NAME];
      const response = await controller.logout({
        token: sessionValue(authCookie.value),
        requestId,
      });

      // Set an explicit tombstone even when the request did not contain a cookie,
      // keeping logout idempotent and ensuring the browser clears path `/`.
      authCookie.set({
        ...createSessionCookieOptions("", options.secureCookies, 0),
        expires: new Date(0),
      });
      return response;
    })
    .get("/me", ({ cookie, requestId }) =>
      controller.me({
        token: sessionValue(cookie[SESSION_COOKIE_NAME].value),
        requestId,
      }),
    );
};

export const createAuthRoutes = createUserAccountRoutes;
