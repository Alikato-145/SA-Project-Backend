export interface DepartmentResponseDto {
  id: string;
  branch_id: string;
  code: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DepartmentListQueryDto {
  page?: unknown;
  page_size?: unknown;
  search?: unknown;
  is_active?: unknown;
  branch_id?: unknown;
}

export interface DepartmentCreateRequestDto {
  branch_id: unknown;
  code: unknown;
  name: unknown;
}

export interface DepartmentUpdateRequestDto {
  code?: unknown;
  name?: unknown;
  /** Parent reassignment is forbidden after creation. */
  branch_id?: unknown;
}

export interface ParsedDepartmentCreateRequest {
  branchId: string;
  code: string;
  name: string;
}

export interface ParsedDepartmentUpdateRequest {
  code?: string;
  name?: string;
}

export interface DepartmentDeactivateRequestDto {
  reason: unknown;
}

export interface ParsedDepartmentDeactivateRequest {
  reason: string;
}

import { ApplicationError } from "../../core/errors/application.error";
import {
  parseDecimalBigIntId,
  parseRequiredTrimmedText,
} from "../organization/organization.validation";

export const parseCreateDepartmentRequest = (
  body: DepartmentCreateRequestDto,
): ParsedDepartmentCreateRequest => ({
  branchId: String(parseDecimalBigIntId(body.branch_id, "branch_id")),
  code: parseRequiredTrimmedText(body.code, "code", 30),
  name: parseRequiredTrimmedText(body.name, "name", 100),
});

export const parseUpdateDepartmentRequest = (
  body: DepartmentUpdateRequestDto,
): ParsedDepartmentUpdateRequest => {
  if (body.branch_id !== undefined) {
    throw new ApplicationError("VALIDATION_ERROR", {
      fieldErrors: { branch_id: ["Invalid value."] },
    });
  }

  const parsed: ParsedDepartmentUpdateRequest = {};
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

export const parseDeactivateDepartmentRequest = (
  body: DepartmentDeactivateRequestDto,
): ParsedDepartmentDeactivateRequest => ({
  reason: parseRequiredTrimmedText(body.reason, "reason", 500),
});
