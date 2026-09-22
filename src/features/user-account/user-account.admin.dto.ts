import type { AccountStatus, RoleCode, RoleScope } from "../../core/auth/auth.types";
import type { SuccessHttpDto } from "../../shared/http/http.dto";

export interface AdminAccountDto {
  id: string;
  username: string;
  status: AccountStatus;
  employee: { id: string; employee_code: string; display_name: string } | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminGrantDto {
  id: string;
  role_code: RoleCode;
  scope: RoleScope;
  branch_id: string | null;
  department_id: string | null;
}

export interface AccountDetailDto {
  account: AdminAccountDto;
  grants: AdminGrantDto[];
}

export interface AccountListDto {
  items: AdminAccountDto[];
  page: number;
  page_size: number;
  total: number;
}

export type AccountListResponseDto = SuccessHttpDto<AccountListDto>;
export type AccountDetailResponseDto = SuccessHttpDto<AccountDetailDto>;
export type TemporaryPasswordResponseDto = SuccessHttpDto<AccountDetailDto & { temporary_password: string }>;
