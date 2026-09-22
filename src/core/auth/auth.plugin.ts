import { jwt } from "@elysiajs/jwt";
import Elysia, { t } from "elysia";
import { ApplicationError } from "../errors/application.error";
import {
  SESSION_COOKIE_NAME,
  type AccountStatus,
  type AuthenticatedActor,
  type AuthenticatedGrant,
} from "./auth.types";
import { parseActiveGrant } from "./authorization";
import { validateCookieMutationRequest } from "./csrf-origin";
import { createSessionTokenService } from "./session-token";

const idPattern = /^[1-9]\d*$/;

export interface ActorGrantRecord {
  grantId: string;
  roleCode: unknown;
  scope: unknown;
  branchId: unknown;
  departmentId: unknown;
  roleActive: boolean;
}

export interface ActorAccountRecord {
  accountId: string;
  employeeId: string | null;
  username: string;
  status: AccountStatus;
  lockedUntil: Date | null;
  grants: readonly ActorGrantRecord[];
}

/** Port implemented by the user-account persistence adapter. */
export interface AuthenticatedActorLoader {
  loadForAuthentication(accountId: string): Promise<ActorAccountRecord | null>;
}

export interface AuthPluginOptions {
  jwtSecret: string;
  allowedOrigins: readonly string[];
  sessionTtlSeconds: number;
  actorLoader: AuthenticatedActorLoader;
  now?: () => Date;
}

const toAuthenticatedGrant = (
  record: ActorGrantRecord,
): AuthenticatedGrant | null => {
  if (!idPattern.test(record.grantId)) return null;
  const parsed = parseActiveGrant(record);
  if (!parsed) return null;

  return {
    grantId: record.grantId,
    roleCode: parsed.roleCode,
    scope: parsed.scope,
    branchId: parsed.branchId,
    departmentId: parsed.departmentId,
  };
};

const assertUsableAccount = (
  record: ActorAccountRecord,
  now: Date,
): AuthenticatedActor => {
  if (
    !idPattern.test(record.accountId) ||
    (record.employeeId !== null && !idPattern.test(record.employeeId)) ||
    !record.username
  ) {
    throw new ApplicationError("AUTH_REQUIRED");
  }

  if (record.status === "disabled") {
    throw new ApplicationError("ACCOUNT_DISABLED");
  }

  if (
    record.status === "locked" &&
    record.lockedUntil !== null &&
    record.lockedUntil.getTime() > now.getTime()
  ) {
    throw new ApplicationError("ACCOUNT_LOCKED", {
      retryAt: record.lockedUntil.toISOString(),
    });
  }

  if (
    record.status !== "active" &&
    !(
      record.status === "locked" &&
      record.lockedUntil !== null &&
      record.lockedUntil.getTime() <= now.getTime()
    )
  ) {
    throw new ApplicationError("AUTH_REQUIRED");
  }

  return {
    accountId: record.accountId,
    employeeId: record.employeeId,
    username: record.username,
    grants: record.grants
      .map(toAuthenticatedGrant)
      .filter((grant): grant is AuthenticatedGrant => grant !== null),
  };
};

/**
 * Provides an `authenticated: true` route macro. Each protected invocation
 * verifies the cookie token and reloads current account/grant state through the
 * injected loader, so disablement and revocation are effective immediately.
 */
export const createAuthPlugin = (options: AuthPluginOptions) => {
  if (options.jwtSecret.length < 32) {
    throw new RangeError("JWT secret must contain at least 32 characters.");
  }

  const now = options.now ?? (() => new Date());

  return new Elysia({ name: "a1-auth" })
    .use(
      jwt({
        name: "sessionJwt",
        secret: options.jwtSecret,
        alg: "HS256",
        schema: t.Object({ sub: t.String() }),
      }),
    )
    .onBeforeHandle({ as: "global" }, ({ request }) => {
      const validation = validateCookieMutationRequest(
        request,
        options.allowedOrigins,
      );
      if (!validation.allowed) {
        throw new ApplicationError(validation.rejection!);
      }
    })
    .macro({
      authenticated: {
        resolve: async ({ cookie, sessionJwt }) => {
          const cookieValue = cookie[SESSION_COOKIE_NAME]?.value;
          const token = typeof cookieValue === "string" ? cookieValue : undefined;
          const tokenService = createSessionTokenService(sessionJwt, {
            ttlSeconds: options.sessionTtlSeconds,
            now: () => now().getTime(),
          });
          const claims = await tokenService.verify(token);
          if (!claims) throw new ApplicationError("AUTH_REQUIRED");

          const record = await options.actorLoader.loadForAuthentication(claims.sub);
          if (!record || record.accountId !== claims.sub) {
            throw new ApplicationError("AUTH_REQUIRED");
          }

          return { actor: assertUsableAccount(record, now()) };
        },
      },
    });
};
