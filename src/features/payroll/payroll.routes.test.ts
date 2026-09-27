import { describe, expect, test } from "bun:test";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { PayrollControllerService } from "./payroll.controller";
import { createPayrollRoutes } from "./payroll.routes";
import { calculationFixture, payrollActor, periodFixture } from "./payroll.test-support";
import { calculatePayroll } from "./calculation/payroll-calculator";

const actor: AuthenticatedActor = payrollActor();
const period = periodFixture();
const configuration = { id: "5", shopId: "1", branchId: null, configKey: "STANDARD_WORK_DAYS" as const,
  numericValue: "20.0000", unit: "days", effectiveFrom: "2026-01-01", effectiveTo: null, createdByUserAccountId: "1" };
const adjustment = { id: "60", originalPayrollRecordId: "70", appliedPayrollPeriodId: "20", direction: "earning" as const,
  amount: "100.00", reason: "Correction", status: "pending" as const, requestedByUserAccountId: "1",
  requestedAt: new Date("2026-09-30T00:00:00Z"), approvedByUserAccountId: null, approvedAt: null, appliedPayrollItemId: null };

const calls: string[] = [];
const service: PayrollControllerService = {
  getPayrollAccess: () => ({ canMutate: true, readableBranchIds: null }),
  createPayrollConfiguration: async () => { calls.push("create-config"); return configuration; },
  listPayrollConfigurations: async () => [configuration],
  createPayrollPeriod: async () => { calls.push("create-period"); return period; },
  listPayrollPeriods: async () => [period], getPayrollPeriod: async () => ({ period, records: [], blockers: [] }),
  getPayrollRecord: async () => ({ id: "70", periodId: "20", status: "locked", ...calculatePayroll(calculationFixture()) }),
  previewPayrollPeriod: async () => ({ period: { ...period, status: "previewed" }, records: [calculatePayroll(calculationFixture())], blockers: [] }),
  lockPayrollPeriod: async () => ({ period: { ...period, status: "locked" }, records: [calculatePayroll(calculationFixture())], blockers: [] }),
  requestPayrollAdjustment: async () => adjustment,
  decidePayrollAdjustment: async (_actor, _id, decision) => ({ ...adjustment, status: decision }),
  listPayrollAdjustments: async () => [adjustment],
};
const app = createPayrollRoutes({ service, authenticate: async () => actor, allowedOrigins: ["http://localhost:3000"] });
const request = (path: string, method = "GET", body?: unknown) => new Request(`http://localhost${path}`, {
  method, headers: body ? { "content-type": "application/json", origin: "http://localhost:3000", "x-request-id": "payroll-route" } : { "x-request-id": "payroll-route" },
  body: body ? JSON.stringify(body) : undefined,
});

describe("payroll routes", () => {
  test("maps configuration and period contracts", async () => {
    const access = await app.handle(request("/api/v1/payroll/access"));
    expect(await access.json()).toMatchObject({ data: { can_mutate: true, readable_branch_ids: null } });
    const list = await app.handle(request("/api/v1/payroll/configurations?shop_id=1"));
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ data: [{ id: "5", config_key: "STANDARD_WORK_DAYS" }], request_id: "payroll-route" });
    const created = await app.handle(request("/api/v1/payroll/periods", "POST", {
      shop_id: "1", period_year: 2026, period_month: 9, start_date: "2026-09-01", end_date: "2026-09-30",
    }));
    expect(created.status).toBe(200);
    expect(calls).toContain("create-period");
  });

  test("maps preview, lock, and adjustment contracts", async () => {
    const preview = await app.handle(request("/api/v1/payroll/periods/20/preview", "POST", {}));
    expect(preview.status).toBe(200);
    const lock = await app.handle(request("/api/v1/payroll/periods/20/lock", "POST", {}));
    expect(lock.status).toBe(200);
    expect(await lock.json()).toMatchObject({ data: { period: { status: "locked" } } });
    const detail = await app.handle(request("/api/v1/payroll/periods/20/records/70"));
    expect(await detail.json()).toMatchObject({ data: { id: "70", payroll_period_id: "20", status: "locked", employee_id: "10" } });
    const list = await app.handle(request("/api/v1/payroll/adjustments?record_id=70"));
    expect(await list.json()).toMatchObject({ data: [{ id: "60", amount: "100.00" }] });
  });

  test("returns stable validation and origin errors", async () => {
    expect((await app.handle(request("/api/v1/payroll/periods/not-id"))).status).toBe(422);
    expect((await app.handle(request("/api/v1/payroll/periods?shop_id=1&page_size=101"))).status).toBe(422);
    const evil = new Request("http://localhost/api/v1/payroll/periods", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.test" },
      body: JSON.stringify({ shop_id: "1", period_year: 2026, period_month: 9, start_date: "2026-09-01", end_date: "2026-09-30" }) });
    expect((await app.handle(evil)).status).toBe(403);
  });
});
