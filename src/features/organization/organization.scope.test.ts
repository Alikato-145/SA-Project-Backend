import { describe, expect, test } from "bun:test";
import {
  canAdministerOrganization,
  projectOrganizationVisibility,
  type OrganizationScopeActor,
} from "./organization.scope";

const actor = (grants: readonly unknown[]): OrganizationScopeActor => ({
  grants,
});

const grant = (
  roleCode: string,
  scope: string,
  branchId: string | null = null,
  departmentId: string | null = null,
  roleActive = true,
) => ({ roleCode, scope, branchId, departmentId, roleActive });

describe("organization visibility projection", () => {
  test.each(["OWNER", "HR"])(
    "%s all-scope grant exposes the complete organization",
    (roleCode) => {
      expect(
        projectOrganizationVisibility(
          actor([grant(roleCode, "all")]),
        ),
      ).toEqual({ all: true, branchIds: [], departmentIds: [] });
    },
  );

  test("unions and deduplicates branch-manager grants without widening to all", () => {
    expect(
      projectOrganizationVisibility(
        actor([
          grant("BRANCH_MANAGER", "branch", "10"),
          grant("BRANCH_MANAGER", "branch", "11"),
          grant("BRANCH_MANAGER", "branch", "10"),
        ]),
      ),
    ).toEqual({
      all: false,
      branchIds: ["10", "11"],
      departmentIds: [],
    });
  });

  test("projects a supervisor grant to its exact department without widening its branch", () => {
    expect(
      projectOrganizationVisibility(
        actor([grant("SUPERVISOR", "department", "10", "20")]),
      ),
    ).toEqual({
      all: false,
      branchIds: [],
      departmentIds: ["20"],
    });
  });

  test("forms the union of branch and department grants without inventing departments", () => {
    expect(
      projectOrganizationVisibility(
        actor([
          grant("SUPERVISOR", "department", "10", "20"),
          grant("BRANCH_MANAGER", "branch", "11"),
          grant("SUPERVISOR", "department", "12", "21"),
        ]),
      ),
    ).toEqual({
      all: false,
      branchIds: ["11"],
      departmentIds: ["20", "21"],
    });
  });

  test("fails closed for Employee self scope until A3 supplies assignment context", () => {
    expect(
      projectOrganizationVisibility(actor([grant("EMPLOYEE", "self")])),
    ).toEqual({ all: false, branchIds: [], departmentIds: [] });
  });

  test("ignores revoked, inactive, malformed, and role/scope-mismatched grants", () => {
    expect(
      projectOrganizationVisibility(
        actor([
          grant("OWNER", "all", null, null, false),
          grant("BRANCH_MANAGER", "branch", "10", null, false),
          grant("SUPERVISOR", "branch", "11"),
          grant("SUPERVISOR", "department", null, "20"),
          grant("CUSTOM", "all"),
          null,
        ]),
      ),
    ).toEqual({ all: false, branchIds: [], departmentIds: [] });
  });

  test("an active all-scope grant dominates narrower grants", () => {
    expect(
      projectOrganizationVisibility(
        actor([
          grant("BRANCH_MANAGER", "branch", "10"),
          grant("HR", "all"),
          grant("SUPERVISOR", "department", "11", "20"),
        ]),
      ),
    ).toEqual({ all: true, branchIds: [], departmentIds: [] });
  });

  test("allows only active Owner or HR all-scope grants to administer organization", () => {
    expect(canAdministerOrganization(actor([grant("OWNER", "all")]))).toBe(true);
    expect(canAdministerOrganization(actor([grant("HR", "all")]))).toBe(true);
    expect(canAdministerOrganization(actor([grant("BRANCH_MANAGER", "branch", "10")]))).toBe(false);
    expect(canAdministerOrganization(actor([grant("OWNER", "all", null, null, false)]))).toBe(false);
  });
});
