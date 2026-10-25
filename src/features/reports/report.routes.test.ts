import { expect, test } from "bun:test";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { createReportRoutes } from "./report.routes";
const actor: AuthenticatedActor = { accountId: "1", employeeId: null, username: "hr", grants: [{ grantId: "1", roleCode: "HR", scope: "all", branchId: null, departmentId: null }] };
test("report routes expose typed CSV downloads", async () => {
  const app = createReportRoutes({ service: { async bankTransfer() { return "bank_code\r\n"; }, async socialSecurity() { return "base_salary\r\n"; } } as never, authenticate: async () => actor });
  const response = await app.handle(new Request("http://test/api/v1/reports/social-security.csv?period_id=1"));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/csv");
  expect(await response.text()).toContain("base_salary");
});
test("report downloads reject malformed IDs and unknown filters with validation errors",async()=>{
 const app=createReportRoutes({service:{} as never,authenticate:async()=>actor});
 for(const query of["period_id=0","period_id=1&branch_id=bad","period_id=1&unknown=2"]){const r=await app.handle(new Request(`http://test/api/v1/reports/salary-summary.pdf?${query}`));expect(r.status).toBe(422);expect((await r.json()).error.code).toBe("VALIDATION_ERROR");}
});
