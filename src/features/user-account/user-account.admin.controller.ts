import type {
  AuthenticatedActor,
  AccountStatus,
  RoleCode,
} from "../../core/auth/auth.types";
import { ApplicationError } from "../../core/errors/application.error";
import {
  toAccountDetailResponseDto,
  toAccountListResponseDto,
  toTemporaryPasswordResponseDto,
} from "./user-account.admin.mapper";
import type { UserAccountAdminService } from "./user-account.admin.service";

const pageNumber = (
  value: string | undefined,
  fallback: number,
  maximum: number,
): number => {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new ApplicationError("VALIDATION_ERROR");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum)
    throw new ApplicationError("VALIDATION_ERROR");
  return parsed;
};

export const createUserAccountAdminController = (
  service: UserAccountAdminService,
) => ({
  async list(input: {
    actor: AuthenticatedActor;
    requestId: string;
    query: {
      page?: string;
      page_size?: string;
      search?: string;
      status?: AccountStatus;
      role_code?: RoleCode;
      branch_id?: string;
      department_id?: string;
    };
  }) {
    const page = pageNumber(input.query.page, 1, 1_000_000);
    const pageSize = pageNumber(input.query.page_size, 20, 100);
    const result = await service.listAccounts({
      actor: input.actor,
      requestId: input.requestId,
      query: {
        page,
        pageSize,
        search: input.query.search?.trim() || undefined,
        status: input.query.status,
        roleCode: input.query.role_code,
        branchId: input.query.branch_id,
        departmentId: input.query.department_id,
      },
    });
    return toAccountListResponseDto(result, page, pageSize, input.requestId);
  },

  async detail(input: {
    actor: AuthenticatedActor;
    requestId: string;
    accountId: string;
  }) {
    return toAccountDetailResponseDto(
      await service.getAccount(input),
      input.requestId,
    );
  },

  async create(input: {
    actor: AuthenticatedActor;
    requestId: string;
    body: { username: string; employee_id?: string | null };
  }) {
    return toTemporaryPasswordResponseDto(
      await service.createAccount({
        actor: input.actor,
        requestId: input.requestId,
        username: input.body.username,
        employeeId: input.body.employee_id ?? null,
      }),
      input.requestId,
    );
  },

  async status(input: {
    actor: AuthenticatedActor;
    requestId: string;
    accountId: string;
    body: { status: "active" | "disabled"; reason: string };
  }) {
    return toAccountDetailResponseDto(
      await service.changeStatus({
        actor: input.actor,
        requestId: input.requestId,
        accountId: input.accountId,
        status: input.body.status,
        reason: input.body.reason,
      }),
      input.requestId,
    );
  },

  async resetPassword(input: {
    actor: AuthenticatedActor;
    requestId: string;
    accountId: string;
    body: { reason: string };
  }) {
    return toTemporaryPasswordResponseDto(
      await service.resetPassword({
        actor: input.actor,
        requestId: input.requestId,
        accountId: input.accountId,
        reason: input.body.reason,
      }),
      input.requestId,
    );
  },

  async unlock(input: {
    actor: AuthenticatedActor;
    requestId: string;
    accountId: string;
    body: { reason: string };
  }) {
    return toAccountDetailResponseDto(
      await service.unlockAccount({
        actor: input.actor,
        requestId: input.requestId,
        accountId: input.accountId,
        reason: input.body.reason,
      }),
      input.requestId,
    );
  },
});
