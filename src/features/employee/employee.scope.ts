import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { parseActiveGrant } from "../../core/auth/authorization";

export interface EmployeeVisibility {
  all: boolean;
  selfEmployeeId: string | null;
  branchIds: readonly string[];
  departments: readonly { branchId: string; departmentId: string }[];
}

/** Derive current read visibility from validated, active A1 grants only. */
export const projectEmployeeVisibility = (
  actor: AuthenticatedActor,
): EmployeeVisibility => {
  const branchIds = new Set<string>();
  const departments = new Map<string, { branchId: string; departmentId: string }>();
  let selfEmployeeId: string | null = null;

  for (const candidate of actor.grants) {
    const grant = parseActiveGrant(candidate);
    if (grant === null) continue;
    if (grant.scope === "all") {
      return { all: true, selfEmployeeId: null, branchIds: [], departments: [] };
    }
    if (grant.scope === "self") {
      selfEmployeeId = actor.employeeId;
    } else if (grant.scope === "branch") {
      branchIds.add(grant.branchId!);
    } else {
      const branchId = grant.branchId!;
      const departmentId = grant.departmentId!;
      departments.set(`${branchId}:${departmentId}`, { branchId, departmentId });
    }
  }

  return {
    all: false,
    selfEmployeeId,
    branchIds: [...branchIds],
    departments: [...departments.values()],
  };
};

/** Master-data writes belong only to current Owner/HR all-scope grants. */
export const canAdministerEmployees = (actor: AuthenticatedActor): boolean =>
  actor.grants.some((candidate) => {
    const grant = parseActiveGrant(candidate);
    return grant !== null && grant.scope === "all" &&
      (grant.roleCode === "OWNER" || grant.roleCode === "HR");
  });
