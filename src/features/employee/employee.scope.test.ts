import { describe, expect, test } from "bun:test";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import {
  canAdministerEmployees,
  projectEmployeeVisibility,
} from "./employee.scope";

const actor = (grants: AuthenticatedActor["grants"], employeeId: string | null = null): AuthenticatedActor => ({
  accountId: "10",
  employeeId,
  username: "test",
  grants,
});

describe("employee scope projection", () => {
  test("Owner and HR get all branches and can administer", () => {
    for (const roleCode of ["OWNER", "HR"] as const) {
      const subject = actor([{ grantId: "1", roleCode, scope: "all", branchId: null, departmentId: null }]);
      expect(projectEmployeeVisibility(subject)).toEqual({ all: true, selfEmployeeId: null, branchIds: [], departments: [] });
      expect(canAdministerEmployees(subject)).toBe(true);
    }
  });

  test("branch and department grants remain distinct", () => {
    const subject = actor([
      { grantId: "1", roleCode: "BRANCH_MANAGER", scope: "branch", branchId: "2", departmentId: null },
      { grantId: "2", roleCode: "SUPERVISOR", scope: "department", branchId: "3", departmentId: "4" },
    ]);
    expect(projectEmployeeVisibility(subject)).toEqual({
      all: false,
      selfEmployeeId: null,
      branchIds: ["2"],
      departments: [{ branchId: "3", departmentId: "4" }],
    });
    expect(canAdministerEmployees(subject)).toBe(false);
  });

  test("self grant exposes only linked employee; malformed or revoked grants fail closed", () => {
    const subject = actor([
      { grantId: "1", roleCode: "EMPLOYEE", scope: "self", branchId: null, departmentId: null },
      { roleCode: "OWNER", scope: "all", branchId: null, departmentId: null, roleActive: false },
      { roleCode: "SUPERVISOR", scope: "department", branchId: "2", departmentId: null },
    ] as unknown as AuthenticatedActor["grants"], "12");
    expect(projectEmployeeVisibility(subject)).toEqual({ all: false, selfEmployeeId: "12", branchIds: [], departments: [] });
    expect(canAdministerEmployees(subject)).toBe(false);
  });
});
