import type { BranchRecord } from "../organization/organization.types";
import type { BranchResponseDto } from "./branch.dto";

/** Pure persistence/domain to public DTO conversion. */
export const toBranchResponseDto = (
  record: BranchRecord,
): BranchResponseDto => ({
  id: record.id,
  shop_id: record.shopId,
  code: record.code,
  name: record.name,
  address: record.address,
  timezone: record.timezone,
  is_active: record.isActive,
  created_at: record.createdAt.toISOString(),
  updated_at: record.updatedAt.toISOString(),
});
