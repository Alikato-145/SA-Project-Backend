import type { AuthenticatedActor } from "../../core/auth/auth.types";
import {
  parseBooleanFilter,
  parseDecimalBigIntId,
  parseOptionalTrimmedText,
  parsePagination,
} from "../organization/organization.validation";
import type {
  DepartmentCreateRequestDto,
  DepartmentDeactivateRequestDto,
  DepartmentListQueryDto,
  DepartmentUpdateRequestDto,
} from "./department.dto";
import {
  parseCreateDepartmentRequest,
  parseDeactivateDepartmentRequest,
  parseUpdateDepartmentRequest,
} from "./department.dto";
import { toDepartmentResponseDto } from "./department.mapper";
import type { DepartmentService } from "./department.service";

export const createDepartmentController = (service: DepartmentService) => ({
  async list(input: {
    actor: AuthenticatedActor;
    requestId: string;
    query: DepartmentListQueryDto;
  }) {
    const pagination = parsePagination(input.query);
    const search = parseOptionalTrimmedText(input.query.search, "search", 150) ?? null;
    const branchId = input.query.branch_id === undefined
      ? null
      : String(parseDecimalBigIntId(input.query.branch_id, "branch_id"));
    const result = await service.listDepartments({
      actor: input.actor,
      requestId: input.requestId,
      page: pagination.page,
      pageSize: pagination.pageSize,
      search,
      isActive: parseBooleanFilter(input.query.is_active, "is_active"),
      branchId,
    });
    return {
      data: result.items.map(toDepartmentResponseDto),
      page: result.page,
      page_size: result.pageSize,
      total: result.total,
      request_id: input.requestId,
    };
  },

  async detail(input: {
    actor: AuthenticatedActor;
    requestId: string;
    departmentId: unknown;
  }) {
    const departmentId = String(parseDecimalBigIntId(input.departmentId, "department_id"));
    const department = await service.getDepartment({
      actor: input.actor,
      requestId: input.requestId,
      departmentId,
    });
    return {
      data: toDepartmentResponseDto(department),
      request_id: input.requestId,
    };
  },

  async create(input: {
    actor: AuthenticatedActor;
    requestId: string;
    body: DepartmentCreateRequestDto;
  }) {
    const command = parseCreateDepartmentRequest(input.body);
    const department = await service.createDepartment({
      actor: input.actor,
      requestId: input.requestId,
      ...command,
    });
    return {
      data: toDepartmentResponseDto(department),
      request_id: input.requestId,
    };
  },

  async update(input: {
    actor: AuthenticatedActor;
    requestId: string;
    departmentId: unknown;
    body: DepartmentUpdateRequestDto;
  }) {
    const id = String(parseDecimalBigIntId(input.departmentId, "department_id"));
    const command = parseUpdateDepartmentRequest(input.body);
    const department = await service.updateDepartment({
      actor: input.actor,
      requestId: input.requestId,
      id,
      ...command,
    });
    return {
      data: toDepartmentResponseDto(department),
      request_id: input.requestId,
    };
  },

  async deactivate(input: {
    actor: AuthenticatedActor;
    requestId: string;
    departmentId: unknown;
    body: DepartmentDeactivateRequestDto;
  }) {
    const id = String(parseDecimalBigIntId(input.departmentId, "department_id"));
    const command = parseDeactivateDepartmentRequest(input.body);
    const department = await service.deactivateDepartment({
      actor: input.actor,
      requestId: input.requestId,
      id,
      ...command,
    });
    return {
      data: toDepartmentResponseDto(department),
      request_id: input.requestId,
    };
  },
});

export type DepartmentController = ReturnType<typeof createDepartmentController>;
