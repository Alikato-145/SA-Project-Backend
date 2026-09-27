import type { SuccessHttpDto } from "../../shared/http/http.dto";
import {
  parseRequiredTrimmedText,
  parseBooleanFilter,
  parseDecimalBigIntId,
  parseOptionalTrimmedText,
  parsePagination,
} from "../organization/organization.validation";
import { ApplicationError } from "../../core/errors/application.error";

export interface PositionDto {
  id: string;
  shop_id: string;
  code: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PositionListQueryDto {
  page?: unknown;
  page_size?: unknown;
  search?: unknown;
  is_active?: unknown;
  shop_id?: unknown;
}

export interface ParsedPositionListQuery {
  page: number;
  pageSize: number;
  search: string | null;
  isActive: boolean;
  shopId: string | null;
}

export type PositionDetailResponseDto = SuccessHttpDto<PositionDto>;

export interface PositionListResponseDto {
  data: PositionDto[];
  page: number;
  page_size: number;
  total: number;
  request_id: string;
}

export interface PositionCreateRequestDto {
  shop_id: unknown;
  code: unknown;
  name: unknown;
}

export interface PositionUpdateRequestDto {
  code?: unknown;
  name?: unknown;
  /** Present only so direct callers receive the immutable-parent error. */
  shop_id?: unknown;
}

export interface ParsedPositionCreateRequest {
  shopId: string;
  code: string;
  name: string;
}

export interface ParsedPositionUpdateRequest {
  code?: string;
  name?: string;
}

export interface PositionDeactivateRequestDto {
  reason: unknown;
}

export interface ParsedPositionDeactivateRequest {
  reason: string;
}

export const parsePositionListQuery = (
  query: PositionListQueryDto,
): ParsedPositionListQuery => {
  const pagination = parsePagination(query);
  const search = parseOptionalTrimmedText(query.search, "search", 150);
  return {
    ...pagination,
    search: search ?? null,
    isActive: parseBooleanFilter(query.is_active, "is_active"),
    shopId:
      query.shop_id === undefined
        ? null
        : String(parseDecimalBigIntId(query.shop_id, "shop_id")),
  };
};

export const parseCreatePositionRequest = (
  body: PositionCreateRequestDto,
): ParsedPositionCreateRequest => ({
  shopId: String(parseDecimalBigIntId(body.shop_id, "shop_id")),
  code: parseRequiredTrimmedText(body.code, "code", 30),
  name: parseRequiredTrimmedText(body.name, "name", 100),
});

export const parseUpdatePositionRequest = (
  body: PositionUpdateRequestDto,
): ParsedPositionUpdateRequest => {
  if (body.shop_id !== undefined) {
    throw new ApplicationError("VALIDATION_ERROR", {
      fieldErrors: { shop_id: ["Invalid value."] },
    });
  }
  const parsed: ParsedPositionUpdateRequest = {};
  if (body.code !== undefined) {
    parsed.code = parseRequiredTrimmedText(body.code, "code", 30);
  }
  if (body.name !== undefined) {
    parsed.name = parseRequiredTrimmedText(body.name, "name", 100);
  }
  if (Object.keys(parsed).length === 0) {
    throw new ApplicationError("VALIDATION_ERROR", {
      fieldErrors: { body: ["At least one field is required."] },
    });
  }
  return parsed;
};

export const parseDeactivatePositionRequest = (
  body: PositionDeactivateRequestDto,
): ParsedPositionDeactivateRequest => ({
  reason: parseRequiredTrimmedText(body.reason, "reason", 500),
});
