import { ApplicationError } from "../../core/errors/application.error";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { parseActiveGrant } from "../../core/auth/authorization";

export const assertPayrollMutationAccess = (actor: AuthenticatedActor): void => {
  const allowed = actor.grants.some((candidate) => {
    const grant = parseActiveGrant(candidate);
    return grant?.scope === "all" && (grant.roleCode === "HR" || grant.roleCode === "OWNER");
  });
  if (!allowed) throw new ApplicationError("FORBIDDEN_SCOPE");
};

export const payrollReadableBranchIds = (actor: AuthenticatedActor): readonly string[] | null => {
  const all = actor.grants.some((candidate) => {
    const grant = parseActiveGrant(candidate);
    return grant?.scope === "all" && (grant.roleCode === "HR" || grant.roleCode === "OWNER");
  });
  if (all) return null;

  const branchIds = actor.grants.flatMap((candidate) => {
    const grant = parseActiveGrant(candidate);
    return grant?.roleCode === "BRANCH_MANAGER" && grant.scope === "branch" && grant.branchId
      ? [grant.branchId]
      : [];
  });
  if (branchIds.length === 0) throw new ApplicationError("FORBIDDEN_SCOPE");
  return [...new Set(branchIds)];
};

export const assertPayrollRecordAccess = (actor: AuthenticatedActor, branchId: string): void => {
  const branches = payrollReadableBranchIds(actor);
  if (branches !== null && !branches.includes(branchId)) {
    throw new ApplicationError("FORBIDDEN_SCOPE");
  }
};
