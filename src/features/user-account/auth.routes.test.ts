import { describe, expect, test } from "bun:test";
import { ApplicationError } from "../../core/errors/application.error";
import type {
  CurrentActorResult,
  UserAccountService,
} from "./user-account.controller";
import { createUserAccountRoutes } from "./user-account.routes";

const origin = "https://payroll.example.test";

const actor: CurrentActorResult = {
  account: {
    id: "12",
    username: "mana",
    status: "active",
    employee: {
      id: "45",
      employeeCode: "EMP-045",
      displayName: "Mana Example",
    },
  },
  grants: [
    {
      id: "20",
      roleCode: "SUPERVISOR",
      scope: "department",
      branchId: "2",
      departmentId: "8",
    },
  ],
  capabilities: ["employee.read.department"],
};

interface ServiceCalls {
  login: Parameters<UserAccountService["login"]>[];
  logout: Parameters<UserAccountService["logout"]>[];
  me: Parameters<UserAccountService["getCurrentActor"]>[];
}

const setup = (overrides: Partial<UserAccountService> = {}) => {
  const calls: ServiceCalls = { login: [], logout: [], me: [] };
  const service: UserAccountService = {
    async login(command) {
      calls.login.push([command]);
      return { token: "signed-session-token", actor };
    },
    async logout(command) {
      calls.logout.push([command]);
    },
    async getCurrentActor(command) {
      calls.me.push([command]);
      return actor;
    },
    ...overrides,
  };

  return {
    calls,
    app: createUserAccountRoutes({
      service,
      allowedOrigins: [origin],
      secureCookies: true,
    }),
  };
};

const mutation = (path: string, body: object = {}) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "x-request-id": "request-route-contract",
    },
    body: JSON.stringify(body),
  });

describe("A1 authentication route contract", () => {
  test("login sets the hardened session cookie and maps a safe actor response", async () => {
    const sensitiveActor = {
      ...actor,
      account: {
        ...actor.account,
        passwordHash: "must-never-leak",
        failedLoginAttempts: 4,
        lockedUntil: new Date("2026-09-22T00:00:00.000Z"),
        bankAccountNumber: "1234567890",
        nationalId: "1100000000000",
      },
    } as CurrentActorResult;
    const { app, calls } = setup({
      async login(command) {
        calls.login.push([command]);
        return { token: "signed-session-token", actor: sensitiveActor };
      },
    });

    const response = await app.handle(
      mutation("/api/v1/auth/login", {
        username: "mana",
        password: "correct horse battery staple",
      }),
    );
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("request-route-contract");
    expect(response.headers.get("set-cookie")).toContain(
      "haris_session=signed-session-token",
    );
    expect(response.headers.get("set-cookie")?.toLowerCase()).toContain(
      "httponly",
    );
    expect(response.headers.get("set-cookie")?.toLowerCase()).toContain(
      "samesite=lax",
    );
    expect(response.headers.get("set-cookie")?.toLowerCase()).toContain(
      "secure",
    );
    expect(response.headers.get("set-cookie")?.toLowerCase()).toContain(
      "max-age=28800",
    );
    expect(payload).toEqual({
      data: {
        account: {
          id: "12",
          username: "mana",
          status: "active",
          employee: {
            id: "45",
            employee_code: "EMP-045",
            display_name: "Mana Example",
          },
        },
        grants: [
          {
            id: "20",
            role_code: "SUPERVISOR",
            scope: "department",
            branch_id: "2",
            department_id: "8",
          },
        ],
        capabilities: ["employee.read.department"],
      },
      request_id: "request-route-contract",
    });
    expect(serialized).not.toContain("must-never-leak");
    expect(serialized).not.toContain("failedLoginAttempts");
    expect(serialized).not.toContain("1234567890");
    expect(serialized).not.toContain("1100000000000");
    expect(calls.login[0]?.[0]).toEqual({
      username: "mana",
      password: "correct horse battery staple",
      requestId: "request-route-contract",
    });
  });

  test("me passes the cookie and request ID to the observed service boundary", async () => {
    const { app, calls } = setup();
    const response = await app.handle(
      new Request("http://localhost/api/v1/auth/me", {
        headers: {
          cookie: "haris_session=current-token",
          "x-request-id": "request-me",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { account: { id: "12" } },
      request_id: "request-me",
    });
    expect(calls.me).toEqual([
      [{ token: "current-token", requestId: "request-me" }],
    ]);
  });

  test("logout is idempotent and always expires the path-wide cookie", async () => {
    const { app, calls } = setup();
    const response = await app.handle(mutation("/api/v1/auth/logout"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { logged_out: true },
      request_id: "request-route-contract",
    });
    expect(calls.logout).toEqual([
      [{ token: undefined, requestId: "request-route-contract" }],
    ]);
    const cookie = response.headers.get("set-cookie")?.toLowerCase();
    expect(cookie).toContain("haris_session=");
    expect(cookie).toContain("max-age=0");
    expect(cookie).toContain("path=/");
    expect(cookie).toContain("httponly");
  });

  test("service failures use the stable public envelope and same request ID", async () => {
    const { app } = setup({
      async login() {
        throw new ApplicationError("INVALID_CREDENTIALS");
      },
    });
    const response = await app.handle(
      mutation("/api/v1/auth/login", {
        username: "unknown",
        password: "wrong",
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "INVALID_CREDENTIALS",
        message: "The username or password is incorrect.",
      },
      request_id: "request-route-contract",
    });
  });

  test("invalid bodies and untrusted origins return stable validation errors", async () => {
    const { app } = setup();
    const invalidBody = await app.handle(
      mutation("/api/v1/auth/login", { username: "mana" }),
    );
    expect(invalidBody.status).toBe(422);
    expect(await invalidBody.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
      request_id: "request-route-contract",
    });

    const badOrigin = await app.handle(
      new Request("http://localhost/api/v1/auth/logout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example.test",
          "x-request-id": "request-origin",
        },
        body: "{}",
      }),
    );
    expect(badOrigin.status).toBe(403);
    expect(await badOrigin.json()).toEqual({
      error: {
        code: "ORIGIN_NOT_ALLOWED",
        message: "The request origin is not allowed.",
      },
      request_id: "request-origin",
    });
  });
});
