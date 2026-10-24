import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import * as schema from "../../db/schema";
import { createSessionJwtCodec } from "../../core/auth/session-jwt-codec";
import { createSessionTokenService } from "../../core/auth/session-token";
import { createRequestAuthenticator } from "../../core/auth/request-authenticator";
import { createAuthenticatedActorLoader } from "./user-account.auth-adapter";
import { UserAccountRepository } from "./user-account.repository";
import { createUserAccountSessionService } from "./user-account.session-service";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseTest = databaseUrl ? test : test.skip;

// Every connection is explicitly bound to TEST_DATABASE_URL, never DATABASE_URL.
databaseTest("AUTH-01: revocation survives reconnect and denies replay without revoking another login", async () => {
  const first = new Client({ connectionString: databaseUrl });
  const second = new Client({ connectionString: databaseUrl });
  let accountId: string | undefined;
  let firstClosed = false;
  await first.connect();
  await second.connect();
  try {
    const account = (await first.query<{ id: string }>(
      "insert into user_accounts(username,password_hash) values($1,'test-only') returning id",
      [`auth-revoke-${crypto.randomUUID()}`],
    )).rows[0]!;
    accountId = account.id;
    const secret = "persistent-session-integration-secret-32-characters";
    const tokens = createSessionTokenService(createSessionJwtCodec(secret));
    const token = await tokens.issue(accountId);
    const independent = await tokens.issue(accountId);
    const repository = new UserAccountRepository(drizzle({ client: first, schema }));
    const sessions = createUserAccountSessionService(repository);
    await Promise.all([
      sessions.revokeSession(token, (await tokens.verify(token))!),
      sessions.revokeSession(token, (await tokens.verify(token))!),
    ]);
    const rows = (await first.query<{ token_hash: string; expires_at: Date }>(
      "select token_hash,expires_at from revoked_session_tokens where user_account_id=$1", [accountId],
    )).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]!.expires_at.getTime()).toBe((await tokens.verify(token))!.exp * 1000);
    await first.end();
    firstClosed = true;

    const restartedRepository = new UserAccountRepository(drizzle({ client: second, schema }));
    const authenticate = createRequestAuthenticator({
      jwtSecret: secret, sessionTtlSeconds: 28_800,
      actorLoader: createAuthenticatedActorLoader(restartedRepository),
      sessionRevocations: createUserAccountSessionService(restartedRepository),
    });
    const request = (value: string) => new Request("http://test/business", { headers: { cookie: `haris_session=${value}` } });
    await expect(authenticate(request(token))).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect((await authenticate(request(independent))).accountId).toBe(accountId);
    // Accounts still reload on each request; disablement also cuts off the other session.
    await second.query("update user_accounts set status='disabled' where id=$1", [accountId]);
    await expect(authenticate(request(independent))).rejects.toMatchObject({ code: "ACCOUNT_DISABLED" });
  } finally {
    if (accountId) {
      await second.query("delete from revoked_session_tokens where user_account_id=$1", [accountId]);
      await second.query("delete from user_accounts where id=$1", [accountId]);
    }
    if (!firstClosed) await first.end();
    await second.end();
  }
}, 15_000);
