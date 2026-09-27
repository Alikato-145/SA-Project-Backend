import { describe, expect, test } from "bun:test";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { ApplicationError } from "../../core/errors/application.error";
import { createRoleRoutes } from "./role.routes";
import type { RoleService } from "./role.service";

const origin = "https://payroll.example.test";
const actor: AuthenticatedActor = {
  accountId: "1", employeeId: null, username: "owner",
  grants: [{ grantId: "1", roleCode: "OWNER", scope: "all", branchId: null, departmentId: null }],
};

const setup = (overrides: Partial<RoleService> = {}) => {
  const calls: unknown[] = [];
  const service = {
    async listRoles(command) {
      calls.push(command);
      return [{ id: "5", code: "OWNER", name: "Owner", scope: "all", isActive: true }];
    },
    async grantRole(command) {
      calls.push(command);
      return { id: "31", accountId: command.accountId, roleId: "2", roleCode: command.roleCode, scope: "department", branchId: command.branchId, departmentId: command.departmentId, grantedByAccountId: command.actor.accountId, grantedAt: new Date("2026-09-22T00:00:00.000Z") };
    },
    async revokeRole(command) { calls.push(command); },
    ...overrides,
  } satisfies RoleService;
  let authentications = 0;
  return {
    calls,
    authentications: () => authentications,
    app: createRoleRoutes({ service, allowedOrigins: [origin], async authenticate() { authentications += 1; return actor; } }),
  };
};

const request = (path: string, method: string, body?: object, requestOrigin = origin) => new Request(`http://localhost${path}`, {
  method,
  headers: { "content-type": "application/json", origin: requestOrigin, "x-request-id": "request-role-route" },
  body: body ? JSON.stringify(body) : undefined,
});

describe("fixed-role route contracts", () => {
  test("returns only the five-role catalog contract with decimal string IDs", async () => {
    const { app, authentications } = setup();
    const response = await app.handle(new Request("http://localhost/api/v1/roles", { headers: { "x-request-id": "request-role-route" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [{ id: "5", code: "OWNER", name: "Owner", scope: "all", is_active: true }], request_id: "request-role-route" });
    expect(authentications()).toBe(1);
  });

  test("maps grant input and response without numeric ID coercion", async () => {
    const { app, calls } = setup();
    const response = await app.handle(request("/api/v1/accounts/9007199254740993/roles", "POST", {
      role_code: "SUPERVISOR", branch_id: "7", department_id: "8", reason: "Promotion",
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { id: "31", account_id: "9007199254740993", role_id: "2", branch_id: "7", department_id: "8" }, request_id: "request-role-route" });
    expect(calls[0]).toMatchObject({ actor, accountId: "9007199254740993", roleCode: "SUPERVISOR", branchId: "7", departmentId: "8", reason: "Promotion", requestId: "request-role-route" });
  });

  test("revokes through the audited service boundary", async () => {
    const { app, calls } = setup();
    const response = await app.handle(request("/api/v1/accounts/9/roles/31", "DELETE", { reason: "Transfer" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { revoked: true }, request_id: "request-role-route" });
    expect(calls[0]).toMatchObject({ actor, accountId: "9", grantId: "31", reason: "Transfer", requestId: "request-role-route" });
  });

  test("has no public role CRUD endpoint and returns stable validation/auth errors", async () => {
    const { app } = setup();
    expect((await app.handle(request("/api/v1/roles", "POST", { code: "CUSTOM" }))).status).toBe(404);

    const invalid = await app.handle(request("/api/v1/accounts/not-an-id/roles", "POST", { role_code: "OWNER", reason: "No" }));
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" }, request_id: "request-role-route" });

    const forbidden = setup({ async listRoles() { throw new ApplicationError("FORBIDDEN_SCOPE"); } }).app;
    const denied = await forbidden.handle(new Request("http://localhost/api/v1/roles", { headers: { "x-request-id": "request-role-route" } }));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: { code: "FORBIDDEN_SCOPE" }, request_id: "request-role-route" });
  });

  test("rejects mutation origins before service execution", async () => {
    const { app, calls } = setup();
    const response = await app.handle(request("/api/v1/accounts/9/roles", "POST", { role_code: "HR", reason: "No" }, "https://evil.test"));
    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});
