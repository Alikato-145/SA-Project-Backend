import type { RoleCode, RoleScope } from "../../core/auth/auth.types";

export interface RoleResponseDto {
  id: string;
  code: RoleCode;
  name: string;
  scope: RoleScope;
  is_active: boolean;
}

export interface RoleGrantResponseDto {
  id: string;
  account_id: string;
  role_id: string;
  role_code: RoleCode;
  scope: RoleScope;
  branch_id: string | null;
  department_id: string | null;
  granted_by_account_id: string;
  granted_at: string;
}

export interface GrantRoleRequestDto {
  role_code: RoleCode;
  branch_id?: string | null;
  department_id?: string | null;
  reason: string;
}
