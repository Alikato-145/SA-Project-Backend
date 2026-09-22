import {
  SESSION_TTL_SECONDS,
  type SessionClaims,
  type SessionCookieOptions,
  type SessionJwtCodec,
} from "./auth.types";

const accountIdPattern = /^[1-9]\d*$/;

export interface SessionTokenService {
  issue(accountId: string): Promise<string>;
  verify(token: string | undefined): Promise<SessionClaims | null>;
}

export interface SessionTokenServiceOptions {
  ttlSeconds?: number;
  now?: () => number;
}

const isSessionClaims = (value: unknown): value is SessionClaims => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const claims = value as Record<string, unknown>;
  return (
    typeof claims.sub === "string" &&
    accountIdPattern.test(claims.sub) &&
    typeof claims.iat === "number" &&
    Number.isInteger(claims.iat) &&
    typeof claims.exp === "number" &&
    Number.isInteger(claims.exp)
  );
};

export const createSessionTokenService = (
  codec: SessionJwtCodec,
  options: SessionTokenServiceOptions = {},
): SessionTokenService => {
  const ttlSeconds = options.ttlSeconds ?? SESSION_TTL_SECONDS;
  const now = options.now ?? Date.now;

  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new RangeError("Session TTL must be a positive integer.");
  }

  return {
    async issue(accountId) {
      if (!accountIdPattern.test(accountId)) {
        throw new TypeError("Account ID must be a positive decimal string.");
      }

      const issuedAt = Math.floor(now() / 1_000);
      return codec.sign({
        sub: accountId,
        iat: true,
        exp: issuedAt + ttlSeconds,
      });
    },

    async verify(token) {
      if (!token) return null;

      let decoded: unknown | false;
      try {
        decoded = await codec.verify(token);
      } catch {
        return null;
      }

      if (!decoded || !isSessionClaims(decoded)) return null;

      const currentTime = Math.floor(now() / 1_000);
      if (decoded.exp <= currentTime || decoded.iat > currentTime) return null;
      if (decoded.exp - decoded.iat > ttlSeconds) return null;

      return {
        sub: decoded.sub,
        iat: decoded.iat,
        exp: decoded.exp,
      };
    },
  };
};

export const createSessionCookieOptions = (
  token: string,
  secure: boolean,
  maxAge = SESSION_TTL_SECONDS,
): SessionCookieOptions => ({
  value: token,
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  secure,
  maxAge,
});
