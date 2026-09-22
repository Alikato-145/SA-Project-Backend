import type {
  AccountStatus,
  RoleCode,
  RoleScope,
} from "../../core/auth/auth.types";
import type { SuccessHttpDto } from "../../shared/http/http.dto";

export interface LoginRequestDto {
  username: string;
  password: string;
}

export interface CurrentEmployeeDto {
  id: string;
  employee_code: string;
  display_name: string;
}

export interface CurrentAccountDto {
  id: string;
  username: string;
  status: AccountStatus;
  employee: CurrentEmployeeDto | null;
}

export interface CurrentGrantDto {
  id: string;
  role_code: RoleCode;
  scope: RoleScope;
  branch_id: string | null;
  department_id: string | null;
}

export interface CurrentActorDto {
  account: CurrentAccountDto;
  grants: CurrentGrantDto[];
  capabilities: string[];
}

export interface LogoutDto {
  logged_out: true;
}

export type LoginResponseDto = SuccessHttpDto<CurrentActorDto>;
export type CurrentActorResponseDto = SuccessHttpDto<CurrentActorDto>;
export type LogoutResponseDto = SuccessHttpDto<LogoutDto>;
