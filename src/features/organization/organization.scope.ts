import { parseActiveGrant } from "../../core/auth/authorization";
import type { OrganizationVisibility } from "./organization.types";

export interface OrganizationScopeActor {
  grants: readonly unknown[];
}

/**
 * Projects current A1 grants into the repository visibility used by A2.
 *
 * A branch grant exposes that branch and its descendants. A department grant
 * contributes only its exact department ID; repositories derive the required
 * parent branch, shop, and shop positions by joining from that department.
 * Keeping its parent branch out of `branchIds` is important because that list
 * represents branch-wide visibility and must not expose sibling departments.
 * Self grants deliberately contribute no organization visibility until A3 can
 * provide dated assignment context.
 */
export const projectOrganizationVisibility = (
  actor: OrganizationScopeActor,
): OrganizationVisibility => {
  const branchIds = new Set<string>();
  const departmentIds = new Set<string>();

  for (const candidate of actor.grants) {
    const grant = parseActiveGrant(candidate);
    if (grant === null) continue;

    if (grant.scope === "all") {
      return { all: true, branchIds: [], departmentIds: [] };
    }

    if (grant.scope === "branch") {
      branchIds.add(grant.branchId!);
      continue;
    }

    if (grant.scope === "department") {
      departmentIds.add(grant.departmentId!);
    }
  }

  return {
    all: false,
    branchIds: [...branchIds],
    departmentIds: [...departmentIds],
  };
};

/** Only current Owner/HR all-scope grants may mutate organization masters. */
export const canAdministerOrganization = (
  actor: OrganizationScopeActor,
): boolean =>
  actor.grants.some((candidate) => {
    const grant = parseActiveGrant(candidate);
    return grant !== null &&
      grant.scope === "all" &&
      (grant.roleCode === "OWNER" || grant.roleCode === "HR");
  });
