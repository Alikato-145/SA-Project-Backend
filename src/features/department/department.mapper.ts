import type { DepartmentRecord } from "../organization/organization.types";
import type { DepartmentResponseDto } from "./department.dto";

/** Pure persistence/domain-to-public conversion at the controller boundary. */
export const toDepartmentResponseDto = (
  department: DepartmentRecord,
): DepartmentResponseDto => ({
  id: department.id,
  branch_id: department.branchId,
  code: department.code,
  name: department.name,
  is_active: department.isActive,
  created_at: department.createdAt.toISOString(),
  updated_at: department.updatedAt.toISOString(),
});
