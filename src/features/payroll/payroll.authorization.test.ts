import { describe, expect, test } from "bun:test";
import type { AuthenticatedActor, RoleCode, RoleScope } from "../../core/auth/auth.types";
import { assertPayrollMutationAccess, assertPayrollRecordAccess, payrollReadableBranchIds } from "./payroll.authorization";

const actor = (roleCode: RoleCode, scope: RoleScope, branchId: string | null = null): AuthenticatedActor => ({
  accountId: "1",
  employeeId: roleCode === "EMPLOYEE" ? "9" : null,
  username: roleCode.toLowerCase(),
  grants: [{ grantId: "1", roleCode, scope, branchId, departmentId: scope === "department" ? "4" : null }],
});

describe("payroll authorization", () => {
  test.each(["HR", "OWNER"] as const)("allows %s all-scope payroll mutation", (role) => {
    expect(() => assertPayrollMutationAccess(actor(role, "all"))).not.toThrow();
  });

  test.each([
    actor("BRANCH_MANAGER", "branch", "7"),
    actor("SUPERVISOR", "department", "7"),
    actor("EMPLOYEE", "self"),
  ])("denies payroll mutation outside HR/owner all scope", (candidate) => {
    expect(() => assertPayrollMutationAccess(candidate)).toThrow();
  });

  test("limits branch managers to their historical branch", () => {
    const manager = actor("BRANCH_MANAGER", "branch", "7");
    expect(payrollReadableBranchIds(manager)).toEqual(["7"]);
    expect(() => assertPayrollRecordAccess(manager, "7")).not.toThrow();
    expect(() => assertPayrollRecordAccess(manager, "8")).toThrow();
  });

  test("allows HR/owner reads across branches and denies supervisors/employees", () => {
    expect(payrollReadableBranchIds(actor("HR", "all"))).toBeNull();
    expect(() => assertPayrollRecordAccess(actor("OWNER", "all"), "99")).not.toThrow();
    expect(() => payrollReadableBranchIds(actor("SUPERVISOR", "department", "7"))).toThrow();
    expect(() => payrollReadableBranchIds(actor("EMPLOYEE", "self"))).toThrow();
  });
});
