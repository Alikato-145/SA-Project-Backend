import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { GrantRoleRequestDto } from "./role.dto";
import { toRoleGrantResponseDto, toRoleResponseDto } from "./role.mapper";
import type { RoleService } from "./role.service";

export const createRoleController = (service: RoleService) => ({
  async list(input: { actor: AuthenticatedActor; requestId: string }) {
    const roles = await service.listRoles(input);
    return { data: roles.map(toRoleResponseDto), request_id: input.requestId };
  },

  async grant(input: { actor: AuthenticatedActor; accountId: string; body: GrantRoleRequestDto; requestId: string }) {
    const grant = await service.grantRole({
      actor: input.actor,
      accountId: input.accountId,
      roleCode: input.body.role_code,
      branchId: input.body.branch_id ?? null,
      departmentId: input.body.department_id ?? null,
      reason: input.body.reason,
      requestId: input.requestId,
    });
    return { data: toRoleGrantResponseDto(grant), request_id: input.requestId };
  },

  async revoke(input: { actor: AuthenticatedActor; accountId: string; grantId: string; reason: string; requestId: string }) {
    await service.revokeRole(input);
    return { data: { revoked: true }, request_id: input.requestId };
  },
});

export type RoleController = ReturnType<typeof createRoleController>;
