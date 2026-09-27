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
  ): Promise<{ account: { id: string }; temporaryPassword: string }>;
}

export interface OnboardingAssignmentPort { createAssignmentInTransaction(executor: DatabaseExecutor, command: { actor: AuthenticatedActor; employeeId: string; branchId: string; departmentId: string; positionId: string; employmentType: "full_time" | "part_time" | "temporary"; baseSalary: string; welfareAmount: string; effectiveFrom: string; effectiveTo: string | null }): Promise<{ id: string }> }
export interface OnboardingBankPort { addBankAccountInTransaction(executor: DatabaseExecutor, command: { employeeId: string; bankCode: string; bankName: string; accountHolderName: string; accountNumber: string; isPrimary: boolean | undefined }): Promise<{ id: string }> }
export interface OnboardingHolidayPort { addHolidayInTransaction(executor: DatabaseExecutor, command: { employeeId: string; weekday: number; effectiveFrom: string; effectiveTo: string | null }): Promise<{ id: string }> }
