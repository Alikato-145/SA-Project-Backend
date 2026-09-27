import type { RoleCode, RoleScope } from "./auth.types";

const idPattern = /^[1-9]\d*$/;
const roleScopes: Readonly<Record<RoleCode, RoleScope>> = {
  EMPLOYEE: "self",
  SUPERVISOR: "department",
  BRANCH_MANAGER: "branch",
  HR: "all",
  OWNER: "all",
};

const roleCodes = new Set<RoleCode>(Object.keys(roleScopes) as RoleCode[]);
const scopes = new Set<RoleScope>(["self", "department", "branch", "all"]);

export interface AuthorizationActor {
  employeeId: string | null;
  grants: readonly unknown[];
}

export interface EvaluatedGrant {
  roleCode: RoleCode;
  scope: RoleScope;
  branchId: string | null;
  departmentId: string | null;
  roleActive?: boolean;
}

export type AuthorizationTarget =
  | { scope: "self"; employeeId: string }
  | { scope: "department"; branchId: string; departmentId: string }
  | { scope: "branch"; branchId: string }
  | { scope: "all" };

export type GrantProposal = EvaluatedGrant;

const isId = (value: unknown): value is string =>
  typeof value === "string" && idPattern.test(value);

const isNullableId = (value: unknown): value is string | null =>
  value === null || isId(value);

export const expectedScopeForRole = (roleCode: RoleCode): RoleScope =>
  roleScopes[roleCode];

export const isValidRoleScope = (
  roleCode: unknown,
  scope: unknown,
): roleCode is RoleCode =>
  typeof roleCode === "string" &&
  roleCodes.has(roleCode as RoleCode) &&
  typeof scope === "string" &&
  scopes.has(scope as RoleScope) &&
  roleScopes[roleCode as RoleCode] === scope;

export const parseActiveGrant = (value: unknown): EvaluatedGrant | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const grant = value as Record<string, unknown>;
  if (
    grant.roleActive !== undefined &&
    typeof grant.roleActive !== "boolean"
  ) {
    return null;
  }
  if (grant.roleActive === false) return null;
  if (!isValidRoleScope(grant.roleCode, grant.scope)) return null;
  if (!isNullableId(grant.branchId) || !isNullableId(grant.departmentId)) {
    return null;
  }

  const roleCode = grant.roleCode as RoleCode;
  const scope = grant.scope as RoleScope;
  const branchId = grant.branchId as string | null;
  const departmentId = grant.departmentId as string | null;

  const validShape =
    (scope === "self" && branchId === null && departmentId === null) ||
    (scope === "department" && branchId !== null && departmentId !== null) ||
    (scope === "branch" && branchId !== null && departmentId === null) ||
    (scope === "all" && branchId === null && departmentId === null);

  return validShape
    ? { roleCode, scope, branchId, departmentId, roleActive: true }
    : null;
};

const isValidTarget = (target: AuthorizationTarget): boolean => {
  switch (target.scope) {
    case "self":
      return isId(target.employeeId);
    case "department":
      return isId(target.branchId) && isId(target.departmentId);
    case "branch":
      return isId(target.branchId);
    case "all":
      return true;
  }
};

export const grantAuthorizesTarget = (
  grant: EvaluatedGrant,
  actorEmployeeId: string | null,
  target: AuthorizationTarget,
): boolean => {
  if (!isValidTarget(target)) return false;

  if (grant.scope === "all") return true;

  if (target.scope === "self") {
    return (
      grant.scope === "self" &&
      actorEmployeeId !== null &&
      actorEmployeeId === target.employeeId
    );
  }

  if (target.scope === "all" || grant.scope === "self") return false;

  if (target.scope === "branch") {
    return grant.scope === "branch" && grant.branchId === target.branchId;
  }

  if (grant.scope === "branch") return grant.branchId === target.branchId;

  return (
    grant.scope === "department" &&
    grant.branchId === target.branchId &&
    grant.departmentId === target.departmentId
  );
};

export const canAccessTarget = (
  actor: AuthorizationActor,
  target: AuthorizationTarget,
): boolean =>
  actor.grants.some((candidate) => {
    const grant = parseActiveGrant(candidate);
    return (
      grant !== null && grantAuthorizesTarget(grant, actor.employeeId, target)
    );
  });

export const canAdministerRole = (
  actor: AuthorizationActor,
  targetRoleCode: RoleCode,
): boolean => {
  if (!roleCodes.has(targetRoleCode)) return false;

  const hasOwnerAuthority = actor.grants.some((candidate) => {
    const grant = parseActiveGrant(candidate);
    return grant?.roleCode === "OWNER" && grant.scope === "all";
  });
  if (hasOwnerAuthority) return true;

  if (targetRoleCode === "OWNER") return false;

  return actor.grants.some((candidate) => {
    const grant = parseActiveGrant(candidate);
    return grant?.roleCode === "HR" && grant.scope === "all";
  });
};

/**
 * Ensures a proposed grant is valid and no wider than at least one current
 * actor grant. The role-administration check remains a separate required gate.
 */
export const isGrantScopeContainedByActor = (
  actor: AuthorizationActor,
  proposal: GrantProposal,
  targetEmployeeId?: string,
): boolean => {
  const validProposal = parseActiveGrant(proposal);
  if (!validProposal) return false;

  const target: AuthorizationTarget =
    validProposal.scope === "all"
      ? { scope: "all" }
      : validProposal.scope === "branch"
        ? { scope: "branch", branchId: validProposal.branchId! }
        : validProposal.scope === "department"
          ? {
              scope: "department",
              branchId: validProposal.branchId!,
              departmentId: validProposal.departmentId!,
            }
          : { scope: "self", employeeId: targetEmployeeId ?? "" };

  return canAccessTarget(actor, target);
};

export const canAssignGrant = (
  actor: AuthorizationActor,
  proposal: GrantProposal,
  targetEmployeeId?: string,
): boolean =>
  canAdministerRole(actor, proposal.roleCode) &&
  isGrantScopeContainedByActor(actor, proposal, targetEmployeeId);
