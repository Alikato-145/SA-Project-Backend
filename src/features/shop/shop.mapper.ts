import type { ShopRecord } from "../organization/organization.types";
import type { ShopResponseDto } from "./shop.dto";

export const toShopResponseDto = (record: ShopRecord): ShopResponseDto => ({
  id: record.id,
  code: record.code,
  name: record.name,
  is_active: record.isActive,
  created_at: record.createdAt.toISOString(),
  updated_at: record.updatedAt.toISOString(),
});
