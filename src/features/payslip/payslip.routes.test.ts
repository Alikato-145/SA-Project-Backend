import { expect, test } from "bun:test";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { createPayslipRoutes } from "./payslip.routes";
const actor: AuthenticatedActor = { accountId: "1", employeeId: "2", username: "employee", grants: [{ grantId: "1", roleCode: "EMPLOYEE", scope: "self", branchId: null, departmentId: null }] };
const service = { async generate() { return { id: "1" }; }, async mine() { return [{ id: "1" }]; }, async get() { return { id: "1" }; }, async deliver() { return { id: "1", status: "sent" }; }, async void() { return { id: "1", status: "voided" }; } } as never;
test("payslip routes retain self-service and validated mutation contracts", async () => {
  const app = createPayslipRoutes({ service, authenticate: async () => actor, allowedOrigins: ["http://localhost:3000"] });
  expect((await app.handle(new Request("http://test/api/v1/payslips/mine"))).status).toBe(200);
  expect((await app.handle(new Request("http://test/api/v1/payslips/1"))).status).toBe(200);
  expect((await app.handle(new Request("http://test/api/v1/payslips/payroll-records/1", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" } }))).status).toBe(200);
  expect((await app.handle(new Request("http://test/api/v1/payslips/1/deliveries", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ recipient_email: "hr@example.test" }) }))).status).toBe(200);
});
