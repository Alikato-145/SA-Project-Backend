import { expect, test } from "bun:test";
import { createEmployeeOperationContextService } from "./employee.operation-context.service";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
const grant = (roleCode: "SUPERVISOR" | "BRANCH_MANAGER", branchId: string, departmentId: string | null) => ({ grantId: "1", roleCode, scope: roleCode === "SUPERVISOR" ? "department" as const : "branch" as const, branchId, departmentId });
const actor = (grants: AuthenticatedActor["grants"]) => ({ accountId: 1, trustedActor: { accountId: "1", employeeId: null, username: "manager", grants } });
const repository = { async datedAssignment() { return { employeeId: 2, branchId: 10, departmentId: 20, shopId: 30, baseSalary: "10000.00" }; }, async branchShop() { return 30; }, async shopBranches() { return [10]; }, async weeklyHoliday() { return false; } };
test("approval authority comes from the same grant matching the dated employee context", async () => {
 const service = createEmployeeOperationContextService(repository);
 const mixed = actor([grant("SUPERVISOR", "10", "20"), grant("BRANCH_MANAGER", "11", null)]);
 expect(await service.assertEmployee(mixed, 2, "2026-09-01", "decide")).toBe("department");
 await expect(service.assertEmployee(actor([grant("SUPERVISOR", "11", "20")]), 2, "2026-09-01", "manage")).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
});
test("ownership uses trusted employee association, not actor account ID", async () => {
 const service = createEmployeeOperationContextService(repository);
 const own = { accountId: 2, trustedActor: { accountId: "2", employeeId: "3", username: "employee", grants: [{ grantId: "1", roleCode: "EMPLOYEE" as const, scope: "self" as const, branchId: null, departmentId: null }] } };
 await expect(service.assertEmployee(own, 2, "2026-09-01", "read")).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
});

test("branch attendance listings expose only a supervisor's matching department",async()=>{
 const service=createEmployeeOperationContextService({...repository,async datedAssignment(employeeId:number){return {employeeId,branchId:10,departmentId:employeeId===2?20:21,shopId:30,baseSalary:"10000.00"};}});
 const rows=[{employeeId:2,workDate:"2026-09-01"},{employeeId:3,workDate:"2026-09-01"}];
 expect(await service.visibleWorkDays(actor([grant("SUPERVISOR","10","20")]),rows)).toEqual([rows[0]!]);
 expect(await service.visibleWorkDays(actor([grant("BRANCH_MANAGER","10",null)]),rows)).toEqual(rows);
});
