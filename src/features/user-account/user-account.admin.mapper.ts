import type { AccountDetailResult, CreatedAccountResult } from "./user-account.admin.service";
import type { AdminAccountRecord, AccountListPage } from "./user-account.admin.repository";
import type {
  AccountDetailDto,
  AccountDetailResponseDto,
  AccountListResponseDto,
  AdminAccountDto,
  TemporaryPasswordResponseDto,
} from "./user-account.admin.dto";

export const toAdminAccountDto = (account: AdminAccountRecord): AdminAccountDto => ({
  id: account.id,
  username: account.username,
  status: account.status,
  employee: account.employeeId !== null && account.employeeCode !== null
    ? {
        id: account.employeeId,
        employee_code: account.employeeCode,
        display_name: [account.employeeFirstName, account.employeeLastName].filter(Boolean).join(" "),
      }
    : null,
  last_login_at: account.lastLoginAt?.toISOString() ?? null,
  created_at: account.createdAt.toISOString(),
  updated_at: account.updatedAt.toISOString(),
});

export const toAccountDetailDto = (result: AccountDetailResult): AccountDetailDto => ({
  account: toAdminAccountDto(result.account),
  grants: result.grants.map((grant) => ({
    id: grant.id,
    role_code: grant.roleCode,
    scope: grant.scope,
    branch_id: grant.branchId,
    department_id: grant.departmentId,
  })),
});

export const toAccountListResponseDto = (
  result: AccountListPage,
  page: number,
  pageSize: number,
  requestId: string,
): AccountListResponseDto => ({
  data: { items: result.records.map(toAdminAccountDto), page, page_size: pageSize, total: result.total },
  request_id: requestId,
});

export const toAccountDetailResponseDto = (
  result: AccountDetailResult,
  requestId: string,
): AccountDetailResponseDto => ({ data: toAccountDetailDto(result), request_id: requestId });

export const toTemporaryPasswordResponseDto = (
  result: CreatedAccountResult,
  requestId: string,
): TemporaryPasswordResponseDto => ({
  data: { ...toAccountDetailDto(result), temporary_password: result.temporaryPassword },
  request_id: requestId,
});
