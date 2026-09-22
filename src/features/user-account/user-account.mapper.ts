import type {
  CurrentActorDto,
  CurrentActorResponseDto,
  LoginResponseDto,
  LogoutResponseDto,
} from "./user-account.dto";
import type { CurrentActorResult } from "./user-account.controller";

export const toCurrentActorDto = (
  actor: CurrentActorResult,
): CurrentActorDto => ({
  account: {
    id: actor.account.id,
    username: actor.account.username,
    status: actor.account.status,
    employee: actor.account.employee
      ? {
          id: actor.account.employee.id,
          employee_code: actor.account.employee.employeeCode,
          display_name: actor.account.employee.displayName,
        }
      : null,
  },
  grants: actor.grants.map((grant) => ({
    id: grant.id,
    role_code: grant.roleCode,
    scope: grant.scope,
    branch_id: grant.branchId,
    department_id: grant.departmentId,
  })),
  capabilities: [...actor.capabilities],
});

export const toLoginResponseDto = (
  actor: CurrentActorResult,
  requestId: string,
): LoginResponseDto => ({
  data: toCurrentActorDto(actor),
  request_id: requestId,
});

export const toCurrentActorResponseDto = (
  actor: CurrentActorResult,
  requestId: string,
): CurrentActorResponseDto => ({
  data: toCurrentActorDto(actor),
  request_id: requestId,
});

export const toLogoutResponseDto = (requestId: string): LogoutResponseDto => ({
  data: { logged_out: true },
  request_id: requestId,
});
