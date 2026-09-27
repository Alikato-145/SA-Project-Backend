import type { PositionRecord } from "../organization/organization.types";
import type {
  PositionDetailResponseDto,
  PositionDto,
  PositionListResponseDto,
} from "./position.dto";
import type { PositionPageResult } from "./position.service";

export const toPositionDto = (record: PositionRecord): PositionDto => ({
  id: record.id,
  shop_id: record.shopId,
  code: record.code,
  name: record.name,
  is_active: record.isActive,
  created_at: record.createdAt.toISOString(),
  updated_at: record.updatedAt.toISOString(),
});

export const toPositionListResponseDto = (
  result: PositionPageResult,
  requestId: string,
): PositionListResponseDto => ({
  data: result.items.map(toPositionDto),
  page: result.page,
  page_size: result.pageSize,
  total: result.total,
  request_id: requestId,
});

export const toPositionDetailResponseDto = (
  record: PositionRecord,
  requestId: string,
): PositionDetailResponseDto => ({
  data: toPositionDto(record),
  request_id: requestId,
});
