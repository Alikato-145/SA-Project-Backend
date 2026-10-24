import { expect, test } from "bun:test";
import { createSessionJwtCodec } from "../../core/auth/session-jwt-codec";
import { createSessionTokenService } from "../../core/auth/session-token";
import { createUserAccountSessionService } from "./user-account.session-service";

const secret = "session-revocation-test-secret-at-least-32-characters";

const setup = () => {
  const rows = new Map<string, { userAccountId: number; tokenHash: string; expiresAt: Date }>();
  const repository = {
    async findSafeById(id: number) {
      return id === 42 ? { id, employeeId: null, username: "active", status: "active" as const, lockedUntil: null } : null;
    },
    async findSessionRevocation(hash: string) { return rows.has(hash); },
    async insertSessionRevocation(row: { userAccountId: number; tokenHash: string; expiresAt: Date }) { rows.set(row.tokenHash, row); },
  };
  return { repository, rows, sessions: createUserAccountSessionService(repository), tokens: createSessionTokenService(createSessionJwtCodec(secret)) };
};

test("revocation stores only a fingerprint and is visible to a new session service", async () => {
  const { repository, rows, sessions, tokens } = setup();
  const token = await tokens.issue("42");
  const independent = await tokens.issue("42");
  const claims = (await tokens.verify(token))!;
  await sessions.revokeSession(token, claims);
  const restarted = createUserAccountSessionService(repository);
  expect(await restarted.isRevoked(token)).toBe(true);
  expect(await restarted.isRevoked(independent)).toBe(false);
  const row = [...rows.values()][0]!;
  expect(row.userAccountId).toBe(42);
  expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  expect(row.expiresAt.getTime()).toBe(claims.exp * 1000);
  expect(JSON.stringify([...rows.values()])).not.toContain(token);
});

test("equivalent JWT signature spellings cannot bypass a revocation", async () => {
  const { sessions, tokens } = setup();
  const token = await tokens.issue("42");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const last = alphabet.indexOf(token.at(-1)!);
  const alternate = token.slice(0, -1) + alphabet[last ^ 1];
  // HS256 has two unused base64url bits; JOSE accepts either spelling.
  expect(await tokens.verify(alternate)).not.toBeNull();
  await sessions.revokeSession(token, (await tokens.verify(token))!);
  expect(await sessions.isRevoked(alternate)).toBe(true);
});
