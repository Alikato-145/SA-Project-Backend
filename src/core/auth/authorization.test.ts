import { describe, expect, test } from "bun:test";
import type { RoleCode, RoleScope } from "./auth.types";
import {
  canAccessTarget,
  canAdministerRole,
  canAssignGrant,
  expectedScopeForRole,
  isGrantScopeContainedByActor,
  parseActiveGrant,
  type AuthorizationActor,
  type EvaluatedGrant,
} from "./authorization";

const grant = (
  roleCode: RoleCode,
  scope: RoleScope,
  branchId: string | null = null,
  departmentId: string | null = null,
  roleActive = true,
): EvaluatedGrant => ({
  roleCode,
  scope,
  branchId,
  departmentId,
  roleActive,
});

const actor = (
  grants: readonly unknown[],
  employeeId: string | null = "100",
): AuthorizationActor => ({ employeeId, grants });

describe("authorization evaluator", () => {
  test("defines the fixed role-to-scope mapping", () => {
    expect(expectedScopeForRole("EMPLOYEE")).toBe("self");
    expect(expectedScopeForRole("SUPERVISOR")).toBe("department");
    expect(expectedScopeForRole("BRANCH_MANAGER")).toBe("branch");
    expect(expectedScopeForRole("HR")).toBe("all");
    expect(expectedScopeForRole("OWNER")).toBe("all");
  });

  test("authorizes only the linked employee for self scope", () => {
    const employee = actor([grant("EMPLOYEE", "self")]);
    expect(canAccessTarget(employee, { scope: "self", employeeId: "100" })).toBe(
      true,
    );
    expect(canAccessTarget(employee, { scope: "self", employeeId: "101" })).toBe(
      false,
    );
    expect(
      canAccessTarget(actor(employee.grants, null), {
        scope: "self",
        employeeId: "100",
      }),
    ).toBe(false);
  });

  test("keeps department and branch boundaries exact", () => {
    const supervisor = actor([
      grant("SUPERVISOR", "department", "10", "20"),
    ]);
    expect(
      canAccessTarget(supervisor, {
        scope: "department",
        branchId: "10",
        departmentId: "20",
      }),
    ).toBe(true);
    expect(
      canAccessTarget(supervisor, {
        scope: "department",
        branchId: "10",
        departmentId: "21",
      }),
    ).toBe(false);
    expect(canAccessTarget(supervisor, { scope: "branch", branchId: "10" })).toBe(
      false,
    );

    const manager = actor([grant("BRANCH_MANAGER", "branch", "10")]);
    expect(canAccessTarget(manager, { scope: "branch", branchId: "10" })).toBe(true);
    expect(
      canAccessTarget(manager, {
        scope: "department",
        branchId: "10",
        departmentId: "99",
      }),
    ).toBe(true);
    expect(canAccessTarget(manager, { scope: "branch", branchId: "11" })).toBe(
      false,
    );
  });

  test("uses the union of multiple grants without widening either grant", () => {
    const multiBranchManager = actor([
      grant("BRANCH_MANAGER", "branch", "10"),
      grant("BRANCH_MANAGER", "branch", "11"),
    ]);

    expect(
      canAccessTarget(multiBranchManager, { scope: "branch", branchId: "10" }),
    ).toBe(true);
    expect(
      canAccessTarget(multiBranchManager, { scope: "branch", branchId: "11" }),
    ).toBe(true);
    expect(
      canAccessTarget(multiBranchManager, { scope: "branch", branchId: "12" }),
    ).toBe(false);
    expect(canAccessTarget(multiBranchManager, { scope: "all" })).toBe(false);
  });

  test("ignores inactive and malformed grants", () => {
    const unusable = actor([
      grant("OWNER", "all", null, null, false),
      grant("SUPERVISOR", "branch", "10"),
      grant("SUPERVISOR", "department", null, "20"),
      { roleCode: "CUSTOM", scope: "all", branchId: null, departmentId: null },
      {
        roleCode: "OWNER",
        scope: "all",
        branchId: null,
        departmentId: null,
        roleActive: "yes",
      },
      null,
    ]);

    expect(canAccessTarget(unusable, { scope: "all" })).toBe(false);
    expect(
      canAccessTarget(unusable, {
        scope: "department",
        branchId: "10",
        departmentId: "20",
      }),
    ).toBe(false);
    expect(parseActiveGrant({})).toBeNull();
  });

  test.each(["HR", "OWNER"] as const)(
    "%s has all-branch A1-A3 scope",
    (roleCode) => {
      const administrator = actor([grant(roleCode, "all")], null);
      expect(canAccessTarget(administrator, { scope: "all" })).toBe(true);
      expect(
        canAccessTarget(administrator, { scope: "branch", branchId: "999" }),
      ).toBe(true);
      expect(
        canAccessTarget(administrator, {
          scope: "department",
          branchId: "999",
          departmentId: "888",
        }),
      ).toBe(true);
    },
  );

  test("allows only Owner to administer Owner roles", () => {
    const hr = actor([grant("HR", "all")]);
    const owner = actor([grant("OWNER", "all")]);

    expect(canAdministerRole(hr, "EMPLOYEE")).toBe(true);
    expect(canAdministerRole(hr, "HR")).toBe(true);
    expect(canAdministerRole(hr, "OWNER")).toBe(false);
    expect(canAdministerRole(owner, "OWNER")).toBe(true);
  });

  test("enforces privilege containment independently of administration policy", () => {
    const branchActor = actor([grant("BRANCH_MANAGER", "branch", "10")]);
    expect(
      isGrantScopeContainedByActor(
        branchActor,
        grant("SUPERVISOR", "department", "10", "20"),
      ),
    ).toBe(true);
    expect(
      isGrantScopeContainedByActor(
        branchActor,
        grant("SUPERVISOR", "department", "11", "20"),
      ),
    ).toBe(false);
    expect(isGrantScopeContainedByActor(branchActor, grant("HR", "all"))).toBe(
      false,
    );

    // Containment alone is insufficient: only HR/Owner may administer roles.
    expect(
      canAssignGrant(
        branchActor,
        grant("SUPERVISOR", "department", "10", "20"),
      ),
    ).toBe(false);
  });

  test("combines role administration and containment for proposed grants", () => {
    const hr = actor([grant("HR", "all")]);
    const owner = actor([grant("OWNER", "all")]);

    expect(
      canAssignGrant(hr, grant("BRANCH_MANAGER", "branch", "77")),
    ).toBe(true);
    expect(canAssignGrant(hr, grant("OWNER", "all"))).toBe(false);
    expect(canAssignGrant(owner, grant("OWNER", "all"))).toBe(true);
    expect(
      canAssignGrant(
        owner,
        grant("SUPERVISOR", "department", null, "20"),
      ),
    ).toBe(false);
  });
});
