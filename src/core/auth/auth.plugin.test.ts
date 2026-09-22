import { describe, expect, test } from "bun:test";
import Elysia from "elysia";
import { isApplicationError } from "../errors/application.error";
import {
  createAuthPlugin,
  type ActorAccountRecord,
  type AuthenticatedActorLoader,
} from "./auth.plugin";
import { SESSION_COOKIE_NAME } from "./auth.types";

const jwtSecret = "a-test-secret-that-is-at-least-32-bytes-long";
const allowedOrigin = "https://payroll.example.com";
const now = new Date();

const activeRecord = (): ActorAccountRecord => ({
  accountId: "42",
  employeeId: "100",
  username: "mana",
  status: "active",
  lockedUntil: null,
  grants: [
    {
      grantId: "1",
      roleCode: "BRANCH_MANAGER",
      scope: "branch",
      branchId: "10",
      departmentId: null,
      roleActive: true,
    },
  ],
});

const createHarness = (loader: AuthenticatedActorLoader) =>
  new Elysia()
    .error({ APPLICATION_ERROR: Error })
    .onError(({ error, set }) => {
      if (!isApplicationError(error)) return;
      set.status = error.status;
      return { code: error.code, retry_at: error.retryAt ?? null };
    })
    .use(
      createAuthPlugin({
        jwtSecret,
        allowedOrigins: [allowedOrigin],
        sessionTtlSeconds: 28_800,
        actorLoader: loader,
        now: () => now,
      }),
    )
    .get(
      "/protected",
      ({ actor }) => ({
        account_id: actor.accountId,
        grant_ids: actor.grants.map((grant) => grant.grantId),
      }),
      { authenticated: true },
    )
    .post("/login", () => ({ ok: true }));

const issueToken = async (loader: AuthenticatedActorLoader) => {
  const issuer = new Elysia()
    .use(
      createAuthPlugin({
        jwtSecret,
        allowedOrigins: [allowedOrigin],
        sessionTtlSeconds: 28_800,
        actorLoader: loader,
        now: () => now,
      }),
    )
    .get("/issue", ({ sessionJwt }) =>
      sessionJwt.sign({ sub: "42", iat: true, exp: Math.floor(now.getTime() / 1000) + 28_800 }),
    );

  return (await issuer.handle(new Request("http://test/issue"))).text();
};

const protectedRequest = (token?: string) => {
  const headers = new Headers();
  if (token) headers.set("cookie", `${SESSION_COOKIE_NAME}=${token}`);
  return new Request("http://test/protected", { headers });
};

describe("authenticated request plugin", () => {
  test("rejects a missing, tampered, or unknown-account session", async () => {
    const loader: AuthenticatedActorLoader = {
      loadForAuthentication: async () => null,
    };
    const app = createHarness(loader);

    expect((await app.handle(protectedRequest())).status).toBe(401);
    expect((await app.handle(protectedRequest("not-a-jwt"))).status).toBe(401);

    const token = await issueToken(loader);
    const unknown = await app.handle(protectedRequest(token));
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toEqual({ code: "AUTH_REQUIRED", retry_at: null });
  });

  test("reloads account state so disablement applies on the next request", async () => {
    let current = activeRecord();
    let loads = 0;
    const loader: AuthenticatedActorLoader = {
      loadForAuthentication: async () => {
        loads += 1;
        return current;
      },
    };
    const app = createHarness(loader);
    const token = await issueToken(loader);

    const first = await app.handle(protectedRequest(token));
    expect(first.status).toBe(200);

    current = { ...current, status: "disabled" };
    const second = await app.handle(protectedRequest(token));
    expect(second.status).toBe(403);
    expect(await second.json()).toEqual({ code: "ACCOUNT_DISABLED", retry_at: null });
    expect(loads).toBe(2);
  });

  test("reloads active grants so revocation applies on the next request", async () => {
    let current = activeRecord();
    const loader: AuthenticatedActorLoader = {
      loadForAuthentication: async () => current,
    };
    const app = createHarness(loader);
    const token = await issueToken(loader);

    const first = await app.handle(protectedRequest(token));
    expect(await first.json()).toEqual({ account_id: "42", grant_ids: ["1"] });

    current = { ...current, grants: [] };
    const second = await app.handle(protectedRequest(token));
    expect(await second.json()).toEqual({ account_id: "42", grant_ids: [] });
  });

  test("filters inactive and malformed grants from the current actor", async () => {
    const current = activeRecord();
    current.grants = [
      { ...current.grants[0]!, roleActive: false },
      { ...current.grants[0]!, grantId: "2", scope: "department" },
    ];
    const loader: AuthenticatedActorLoader = {
      loadForAuthentication: async () => current,
    };
    const app = createHarness(loader);
    const token = await issueToken(loader);

    expect(await (await app.handle(protectedRequest(token))).json()).toEqual({
      account_id: "42",
      grant_ids: [],
    });
  });

  test("denies an active lock and permits an expired temporary lock", async () => {
    let current: ActorAccountRecord = {
      ...activeRecord(),
      status: "locked",
      lockedUntil: new Date(now.getTime() + 60_000),
    };
    const loader: AuthenticatedActorLoader = {
      loadForAuthentication: async () => current,
    };
    const app = createHarness(loader);
    const token = await issueToken(loader);

    const locked = await app.handle(protectedRequest(token));
    expect(locked.status).toBe(423);
    expect(await locked.json()).toEqual({
      code: "ACCOUNT_LOCKED",
      retry_at: current.lockedUntil!.toISOString(),
    });

    current = { ...current, lockedUntil: new Date(now.getTime() - 1) };
    expect((await app.handle(protectedRequest(token))).status).toBe(200);
  });

  test("guards public and protected JSON mutations by exact Origin", async () => {
    const loader: AuthenticatedActorLoader = {
      loadForAuthentication: async () => activeRecord(),
    };
    const app = createHarness(loader);

    const missingOrigin = await app.handle(
      new Request("http://test/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
    );
    expect(missingOrigin.status).toBe(403);
    expect(await missingOrigin.json()).toEqual({
      code: "ORIGIN_NOT_ALLOWED",
      retry_at: null,
    });

    const wrongContentType = await app.handle(
      new Request("http://test/login", {
        method: "POST",
        headers: { origin: allowedOrigin, "content-type": "text/plain" },
      }),
    );
    expect(wrongContentType.status).toBe(415);

    const allowed = await app.handle(
      new Request("http://test/login", {
        method: "POST",
        headers: { origin: allowedOrigin, "content-type": "application/json" },
      }),
    );
    expect(allowed.status).toBe(200);
  });
});
