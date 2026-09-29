import { describe, expect, test } from "bun:test";
import type { PayrollControllerService } from "./payroll.controller";
import { payrollActor, periodFixture } from "./payroll.test-support";
import { createUserAccountRoutes } from "../user-account/user-account.routes";
import type { UserAccountService } from "../user-account/user-account.controller";

process.env.AUTH_JWT_SECRET ??= "payroll-app-test-secret-at-least-32-characters";
process.env.AUTH_ALLOWED_ORIGINS ??= "http://localhost:3000";
process.env.DATABASE_URL ??= "postgresql://postgres@localhost/haris_payroll";
const { createApp } = await import("../../app");

const period = periodFixture();
const unsupported = async (): Promise<never> => { throw new Error("not used by smoke test"); };
const service: PayrollControllerService = {
  getPayrollAccess: () => ({ canMutate: true, readableBranchIds: null }),
  createPayrollConfiguration: unsupported,
  listPayrollConfigurations: async () => [],
  createPayrollPeriod: unsupported,
  listPayrollPeriods: async () => [period],
  getPayrollPeriod: async () => ({ period, records: [], blockers: [] }),
  getPayrollRecord: unsupported,
  previewPayrollPeriod: unsupported,
  lockPayrollPeriod: unsupported,
  requestPayrollAdjustment: unsupported,
  decidePayrollAdjustment: unsupported,
  listPayrollAdjustments: async () => [],
};

const authenticationService: UserAccountService = {
  async login() {
    return {
      token: "test-session",
      actor: {
        account: { id: "1", username: "admin", status: "active", employee: null },
        grants: [],
        capabilities: [],
      },
    };
  },
  async logout() {},
  async getCurrentActor() {
    return {
      account: { id: "1", username: "admin", status: "active", employee: null },
      grants: [],
      capabilities: [],
    };
  },
};

describe("payroll app composition", () => {
  test("registers the payroll plugin at the central app root", async () => {
    const app = createApp({
      service,
      authenticate: async () => payrollActor(),
      allowedOrigins: ["http://localhost:3000"],
    });
    const response = await app.handle(new Request("http://localhost/api/v1/payroll/periods?shop_id=1", {
      headers: { "x-request-id": "app-payroll-smoke" },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: [{ id: "20" }], request_id: "app-payroll-smoke" });
  });

  test("registers the existing authentication plugin at the central app root", async () => {
    const app = createApp(
      {
        service,
        authenticate: async () => payrollActor(),
        allowedOrigins: ["http://localhost:3000"],
      },
      {
        service: authenticationService,
        allowedOrigins: ["http://localhost:3000"],
        secureCookies: false,
      },
    );
    const response = await app.handle(
      new Request("http://localhost/api/v1/auth/me", {
        headers: {
          cookie: "haris_session=test-session",
          "x-request-id": "app-auth-smoke",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { account: { id: "1", username: "admin" } },
      request_id: "app-auth-smoke",
    });
  });

  test("registers organization, account, and fixed-role administration at the central app root", () => {
    const routes = createApp({
      service,
      authenticate: async () => payrollActor(),
      allowedOrigins: ["http://localhost:3000"],
    }).routes.map(({ method, path }) => `${method} ${path}`);

    expect(routes).toEqual(expect.arrayContaining([
      "GET /api/v1/shops",
      "POST /api/v1/shops",
      "GET /api/v1/accounts/",
      "GET /api/v1/roles",
      "POST /api/v1/accounts/:accountId/roles",
      "GET /api/v1/audit-logs/",
    ]));
  });
});
