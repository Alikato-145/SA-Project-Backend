import type {
  ActorAccountRecord,
  AuthenticatedActorLoader,
} from "../../core/auth/auth.plugin";
import { parseAccountId } from "../../core/auth/authenticated-actor";
import {
  userAccountRepository,
} from "./user-account.repository";
import type { UserAccountRepository } from "./user-account.repository";

export type AuthenticationActorPersistence = Pick<
  UserAccountRepository,
  "findSafeById" | "findActiveGrants"
>;

/**
 * Persistence adapter for the protected-request plugin. It deliberately reloads
 * account state and active grants instead of trusting authorization data in JWTs.
 */
export const createAuthenticatedActorLoader = (
  repository: AuthenticationActorPersistence = userAccountRepository,
): AuthenticatedActorLoader => ({
  async loadForAuthentication(accountId): Promise<ActorAccountRecord | null> {
    const internalId = parseAccountId(accountId);
    if (internalId === null) return null;

    const account = await repository.findSafeById(internalId);
    if (!account) return null;

    const grants = await repository.findActiveGrants(internalId);
    return {
      accountId: String(account.id),
      employeeId:
        account.employeeId === null ? null : String(account.employeeId),
      username: account.username,
      status: account.status,
      lockedUntil: account.lockedUntil,
      grants: grants.map((grant) => ({
        grantId: String(grant.id),
        roleCode: grant.roleCode,
        scope: grant.scope,
        branchId: grant.branchId === null ? null : String(grant.branchId),
        departmentId:
          grant.departmentId === null ? null : String(grant.departmentId),
        roleActive: true,
      })),
    };
  },
});

export const authenticatedActorLoader = createAuthenticatedActorLoader();
