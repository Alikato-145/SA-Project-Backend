export interface BranchResponseDto {
  id: string;
  shop_id: string;
  code: string;
  name: string;
  address: string | null;
  timezone: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BranchListQueryDto {
  page?: unknown;
  page_size?: unknown;
  search?: unknown;
  is_active?: unknown;
  shop_id?: unknown;
}

export interface BranchListResponseDto {
  data: BranchResponseDto[];
  page: number;
  page_size: number;
  total: number;
  request_id: string;
}

export interface BranchDetailResponseDto {
  data: BranchResponseDto;
  request_id: string;
}

export interface BranchCreateRequestDto {
  shop_id: unknown;
  code: unknown;
  name: unknown;
  address?: unknown;
  timezone?: unknown;
}

export interface BranchUpdateRequestDto {
  code?: unknown;
  name?: unknown;
  address?: unknown;
  timezone?: unknown;
  /** Never valid; declared only so direct parser callers cannot bypass immutability. */
  shop_id?: unknown;
}

export interface BranchDeactivateRequestDto {
  reason: unknown;
}

export interface ParsedBranchCreateRequest {
  shopId: string;
  code: string;
  name: string;
  address: string | null;
  timezone: string;
}

export interface ParsedBranchUpdateRequest {
  code?: string;
  name?: string;
  address?: string | null;
  timezone?: string;
}

import { ApplicationError } from "../../core/errors/application.error";
import {
  parseDecimalBigIntId,
  parseIanaTimezone,
  parseOptionalTrimmedText,
  parseRequiredTrimmedText,
} from "../organization/organization.validation";

export const parseCreateBranchRequest = (
  body: BranchCreateRequestDto,
): ParsedBranchCreateRequest => ({
  shopId: String(parseDecimalBigIntId(body.shop_id, "shop_id")),
  code: parseRequiredTrimmedText(body.code, "code", 30),
  name: parseRequiredTrimmedText(body.name, "name", 150),
  address: parseOptionalTrimmedText(body.address, "address", 500) ?? null,
  timezone: parseIanaTimezone(body.timezone, "timezone"),
});

export const parseUpdateBranchRequest = (
  body: BranchUpdateRequestDto,
): ParsedBranchUpdateRequest => {
  if (body.shop_id !== undefined) {
    throw new ApplicationError("VALIDATION_ERROR", {
      fieldErrors: { shop_id: ["Invalid value."] },
    });
  }

  const parsed: ParsedBranchUpdateRequest = {};
  if (body.code !== undefined) {
    parsed.code = parseRequiredTrimmedText(body.code, "code", 30);
  }
  if (body.name !== undefined) {
    parsed.name = parseRequiredTrimmedText(body.name, "name", 150);
  }
  if (body.address !== undefined) {
    parsed.address = parseOptionalTrimmedText(body.address, "address", 500) ?? null;
  }
  if (body.timezone !== undefined) {
    parsed.timezone = parseIanaTimezone(body.timezone, "timezone");
  }

  if (Object.keys(parsed).length === 0) {
    throw new ApplicationError("VALIDATION_ERROR", {
      fieldErrors: { body: ["At least one field is required."] },
    });
  }
  return parsed;
};
