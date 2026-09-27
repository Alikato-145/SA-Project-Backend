import { jwtVerify } from "jose";
import { ApplicationError } from "../errors/application.error";
import type { AuthenticatedActorLoader } from "./auth.plugin";
import { assertUsableAccount } from "./auth.plugin";
import { SESSION_COOKIE_NAME, type AuthenticatedActor } from "./auth.types";
import { createSessionTokenService } from "./session-token";

const cookieValue = (request: Request, name: string): string | undefined => {
  const entry = request.headers.get("cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!entry) return undefined;
  const value = entry.slice(name.length + 1);
  return value ? decodeURIComponent(value) : undefined;
};

export const createRequestAuthenticator = (options: {
  jwtSecret: string;
  sessionTtlSeconds: number;
  actorLoader: AuthenticatedActorLoader;
  now?: () => Date;
}) => {
  const now = options.now ?? (() => new Date());
  const key = new TextEncoder().encode(options.jwtSecret);
  const tokens = createSessionTokenService({
    async sign() { throw new Error("Request authenticator cannot issue tokens"); },
    async verify(token) {
      if (!token) return false;
      try {
        return (await jwtVerify(token, key, { algorithms: ["HS256"] })).payload;
      } catch {
        return false;
      }
    },
  }, { ttlSeconds: options.sessionTtlSeconds, now: () => now().getTime() });

  return async (request: Request): Promise<AuthenticatedActor> => {
    const claims = await tokens.verify(cookieValue(request, SESSION_COOKIE_NAME));
    if (!claims) throw new ApplicationError("AUTH_REQUIRED");
    const record = await options.actorLoader.loadForAuthentication(claims.sub);
    if (!record || record.accountId !== claims.sub) throw new ApplicationError("AUTH_REQUIRED");
    return assertUsableAccount(record, now());
  };
};
