import { createHash } from "node:crypto";
import { parseAccountId } from "../../core/auth/authenticated-actor";
import type { SessionClaims } from "../../core/auth/auth.types";
import type { SessionRevocationChecker } from "../../core/auth/session-token";
import type { UserAccountRepository } from "./user-account.repository";

export interface UserAccountSessionService extends SessionRevocationChecker {
  revokeSession(token: string, claims: SessionClaims): Promise<void>;
}

const fingerprint = (token: string) => {
  // JOSE tolerates unused base64url signature bits. Normalize them so an
  // equivalent spelling cannot evade the fingerprint of a revoked JWT.
  const [header, payload, signature] = token.split(".");
  const canonical = `${header}.${payload}.${Buffer.from(signature ?? "", "base64url").toString("base64url")}`;
  return createHash("sha256").update(canonical).digest("hex");
};

export const createUserAccountSessionService = (
  repository: Pick<UserAccountRepository, "findSessionRevocation" | "insertSessionRevocation" | "findSafeById">,
): UserAccountSessionService => ({
  async isRevoked(token) {
    return repository.findSessionRevocation(fingerprint(token));
  },
  async revokeSession(token, claims) {
    const accountId = parseAccountId(claims.sub);
    if (accountId === null || !await repository.findSafeById(accountId)) return;
    await repository.insertSessionRevocation({
      userAccountId: accountId,
      tokenHash: fingerprint(token),
      expiresAt: new Date(claims.exp * 1_000),
    });
  },
});
