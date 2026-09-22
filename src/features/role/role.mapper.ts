import type { RoleRecord } from "./role.repository";
import type { RoleGrantResult } from "./role.service";
import type { RoleGrantResponseDto, RoleResponseDto } from "./role.dto";

export const toRoleResponseDto = (role: RoleRecord): RoleResponseDto => ({
  id: role.id,
  code: role.code,
  name: role.name,
  scope: role.scope,
  is_active: role.isActive,
});

export const toRoleGrantResponseDto = (grant: RoleGrantResult): RoleGrantResponseDto => ({
  id: grant.id,
  account_id: grant.accountId,
  role_id: grant.roleId,
  role_code: grant.roleCode,
  scope: grant.scope,
  branch_id: grant.branchId,
  department_id: grant.departmentId,
  granted_by_account_id: grant.grantedByAccountId,
  granted_at: grant.grantedAt.toISOString(),
});
