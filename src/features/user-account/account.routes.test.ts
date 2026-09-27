import { describe, expect, test } from "bun:test";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { createUserAccountAdminRoutes } from "./user-account.admin.routes";
import type { UserAccountAdminService } from "./user-account.admin.service";

const origin = "https://payroll.example.test";
const actor: AuthenticatedActor = {
  accountId: "1", employeeId: null, username: "owner",
  grants: [{ grantId: "1", roleCode: "OWNER", scope: "all", branchId: null, departmentId: null }],
};
const account = {
  id: "9", employeeId: "45", employeeCode: "EMP-045", employeeFirstName: "Mana", employeeLastName: "Example",
  username: "mana", status: "active" as const, failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: null,
  createdAt: new Date("2026-09-22T00:00:00.000Z"), updatedAt: new Date("2026-09-22T00:00:00.000Z"),
};

const setup = () => {
  const calls: unknown[] = [];
  const service = {
    async listAccounts(command) { calls.push(command); return { records: [account], total: 1 }; },
    async getAccount(command) { calls.push(command); return { account, grants: [] }; },
    async createAccount(command) { calls.push(command); return { account, grants: [], temporaryPassword: "Temp!OneTime" }; },
    async changeStatus(command) { calls.push(command); return { account: { ...account, status: command.status }, grants: [] }; },
    async resetPassword(command) { calls.push(command); return { account, grants: [], temporaryPassword: "Temp!Reset" }; },
    async unlockAccount(command) { calls.push(command); return { account, grants: [] }; },
  } satisfies UserAccountAdminService;
  return { calls, app: createUserAccountAdminRoutes({ service, allowedOrigins: [origin], async authenticate() { return actor; } }) };
};

const mutation = (path: string, method: string, body: object) => new Request(`http://localhost${path}`, {
  method, headers: { "content-type": "application/json", origin, "x-request-id": "req-account-route" }, body: JSON.stringify(body),
});

describe("account administration route contracts", () => {
  test("lists safe account DTOs with stable pagination", async () => {
    const { app, calls } = setup();
    const response = await app.handle(new Request("http://localhost/api/v1/accounts/?page=2&page_size=10&status=active&role_code=HR&branch_id=7&department_id=8", { headers: { "x-request-id": "req-account-route" } }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({ data: { items: [{ id: "9", username: "mana", employee: { id: "45", employee_code: "EMP-045" } }], page: 2, page_size: 10, total: 1 }, request_id: "req-account-route" });
    expect(JSON.stringify(payload)).not.toContain("failedLoginAttempts");
    expect(calls[0]).toMatchObject({ query: { page: 2, pageSize: 10, status: "active", roleCode: "HR", branchId: "7", departmentId: "8" } });
  });

  test("returns temporary passwords only from create and reset responses", async () => {
    const { app } = setup();
    const created = await app.handle(mutation("/api/v1/accounts/", "POST", { username: "mana", employee_id: "45" }));
    expect((await created.json()).data.temporary_password).toBe("Temp!OneTime");
    const detail = await app.handle(new Request("http://localhost/api/v1/accounts/9", { headers: { "x-request-id": "req-account-route" } }));
    expect(JSON.stringify(await detail.json())).not.toContain("temporary_password");
    const reset = await app.handle(mutation("/api/v1/accounts/9/reset-password", "POST", { reason: "Verified" }));
    expect((await reset.json()).data.temporary_password).toBe("Temp!Reset");
  });

  test("maps status and unlock commands without numeric ID coercion", async () => {
    const { app, calls } = setup();
    expect((await app.handle(mutation("/api/v1/accounts/9007199254740993/status", "PATCH", { status: "disabled", reason: "Left" }))).status).toBe(200);
    expect((await app.handle(mutation("/api/v1/accounts/9/unlock", "POST", { reason: "Verified" }))).status).toBe(200);
    expect(calls[0]).toMatchObject({ accountId: "9007199254740993", status: "disabled", reason: "Left" });
    expect(calls[1]).toMatchObject({ accountId: "9", reason: "Verified" });
  });

  test("returns stable validation and origin errors before service execution", async () => {
    const { app, calls } = setup();
    const invalid = await app.handle(new Request("http://localhost/api/v1/accounts/?page=0", { headers: { "x-request-id": "req-account-route" } }));
    expect(invalid.status).toBe(422);
    const badOrigin = await app.handle(new Request("http://localhost/api/v1/accounts/9/unlock", {
      method: "POST", headers: { "content-type": "application/json", origin: "https://evil.test", "x-request-id": "req-account-route" }, body: JSON.stringify({ reason: "No" }),
    }));
    expect(badOrigin.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});
