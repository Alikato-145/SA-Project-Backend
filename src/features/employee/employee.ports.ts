import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { DatabaseExecutor } from "../../core/db/transaction";

/** Cross-feature operations used by A3 orchestration. Implementations remain in their owning services. */
export interface AssignmentOrganizationValidationPort {
  validateActiveAssignmentPath(
    executor: DatabaseExecutor,
    path: {
      branchId: string;
      departmentId: string;
      positionId: string;
    },
  ): Promise<void>;
}

export interface OnboardingAccountCreationPort {
  createAccountInTransaction(
    executor: DatabaseExecutor,
    command: {
      actor: AuthenticatedActor;
      username: string;
      employeeId: string;
    },
  ): Promise<{ accountId: string; temporaryPassword: string }>;
}
