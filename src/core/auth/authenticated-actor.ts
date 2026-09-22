import type {
  AccountStatus,
  AuthenticatedActor,
  AuthenticatedGrant,
} from "./auth.types";

export interface CurrentAccountRecord {
  id: number;
  employeeId: number | null;
  username: string;
  status: AccountStatus;
}

export interface CurrentGrantRecord {
  id: number;
  roleCode: AuthenticatedGrant["roleCode"];
  scope: AuthenticatedGrant["scope"];
  branchId: number | null;
  departmentId: number | null;
}

export interface AuthenticatedActorRepository {
  findSafeById(accountId: number): Promise<CurrentAccountRecord | null>;
  findActiveGrants(accountId: number): Promise<CurrentGrantRecord[]>;
}

const positiveDecimalId = /^[1-9]\d*$/;

export const parseAccountId = (accountId: string): number | null => {
  if (!positiveDecimalId.test(accountId)) return null;
  const parsed = Number(accountId);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

/**
 * Reloads account state and active grants for each protected action. A stale token
 * therefore cannot preserve a disabled account or a revoked/inactive role.
 */
export const loadAuthenticatedActor = async (
  accountId: string,
  repository: AuthenticatedActorRepository,
): Promise<AuthenticatedActor | null> => {
  const internalAccountId = parseAccountId(accountId);
  if (internalAccountId === null) return null;

  const account = await repository.findSafeById(internalAccountId);
  if (!account || account.status !== "active") return null;

  const grants = await repository.findActiveGrants(internalAccountId);
  return {
    accountId: String(account.id),
    employeeId: account.employeeId === null ? null : String(account.employeeId),
    username: account.username,
    grants: grants.map(
      (grant): AuthenticatedGrant => ({
        grantId: String(grant.id),
        roleCode: grant.roleCode,
        scope: grant.scope,
        branchId: grant.branchId === null ? null : String(grant.branchId),
        departmentId:
          grant.departmentId === null ? null : String(grant.departmentId),
      }),
    ),
  };
};
