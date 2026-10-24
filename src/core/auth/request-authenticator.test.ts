import { expect, test } from "bun:test";
import { createSessionJwtCodec } from "./session-jwt-codec";
import { createSessionTokenService } from "./session-token";
import { createRequestAuthenticator } from "./request-authenticator";

const jwtSecret = "request-authenticator-test-secret-at-least-32-characters";

test("business authenticator rejects a revoked cookie while another session remains valid", async () => {
  const tokens = createSessionTokenService(createSessionJwtCodec(jwtSecret));
  const first = await tokens.issue("42");
  const second = await tokens.issue("42");
  let revoked = false;
  const authenticate = createRequestAuthenticator({
    jwtSecret, sessionTtlSeconds: 28_800,
    actorLoader: { async loadForAuthentication() {
      return { accountId: "42", employeeId: null, username: "active", status: "active", lockedUntil: null, grants: [] };
    } },
    sessionRevocations: { async isRevoked(token: string) { return revoked && token === first; } },
  });
  const request = (token: string) => new Request("http://test/business", { headers: { cookie: `haris_session=${token}` } });
  expect((await authenticate(request(first))).accountId).toBe("42");
  revoked = true;
  await expect(authenticate(request(first))).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  expect((await authenticate(request(second))).accountId).toBe("42");
});
