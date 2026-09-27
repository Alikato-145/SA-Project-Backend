import type { AuthenticatedActor } from "../../core/auth/auth.types";
import {
  parseBooleanFilter,
  parseDecimalBigIntId,
  parsePagination,
  parseRequiredTrimmedText,
} from "../organization/organization.validation";
import type {
  BranchCreateRequestDto,
  BranchDeactivateRequestDto,
  BranchDetailResponseDto,
  BranchListQueryDto,
  BranchListResponseDto,
  BranchUpdateRequestDto,
} from "./branch.dto";
import {
  parseCreateBranchRequest,
  parseUpdateBranchRequest,
} from "./branch.dto";
import { toBranchResponseDto } from "./branch.mapper";
import type { BranchService } from "./branch.service";

const optionalSearch = (value: unknown): string | null =>
  value === undefined
    ? null
    : parseRequiredTrimmedText(value, "search", 150);

const optionalId = (value: unknown, field: string): string | null =>
  value === undefined ? null : String(parseDecimalBigIntId(value, field));

export const createBranchController = (service: BranchService) => ({
  async list(input: {
    actor: AuthenticatedActor;
    requestId: string;
    query: BranchListQueryDto;
  }): Promise<BranchListResponseDto> {
    const pagination = parsePagination(input.query);
    const page = await service.listBranches({
      actor: input.actor,
      requestId: input.requestId,
      ...pagination,
      search: optionalSearch(input.query.search),
      isActive: parseBooleanFilter(input.query.is_active, "is_active"),
      shopId: optionalId(input.query.shop_id, "shop_id"),
    });
    return {
      data: page.items.map(toBranchResponseDto),
      page: page.page,
      page_size: page.pageSize,
      total: page.total,
      request_id: input.requestId,
    };
  },

  async detail(input: {
    actor: AuthenticatedActor;
    requestId: string;
    branchId: string;
  }): Promise<BranchDetailResponseDto> {
    const id = String(parseDecimalBigIntId(input.branchId, "branch_id"));
    const record = await service.getBranch({
      actor: input.actor,
      requestId: input.requestId,
      id,
    });
    return { data: toBranchResponseDto(record), request_id: input.requestId };
  },

  async create(input: {
    actor: AuthenticatedActor;
    requestId: string;
    body: BranchCreateRequestDto;
  }): Promise<BranchDetailResponseDto> {
    const command = parseCreateBranchRequest(input.body);
    const record = await service.createBranch({
      actor: input.actor,
      requestId: input.requestId,
      ...command,
    });
    return { data: toBranchResponseDto(record), request_id: input.requestId };
  },

  async update(input: {
    actor: AuthenticatedActor;
    requestId: string;
    branchId: string;
    body: BranchUpdateRequestDto;
  }): Promise<BranchDetailResponseDto> {
    const id = String(parseDecimalBigIntId(input.branchId, "branch_id"));
    const command = parseUpdateBranchRequest(input.body);
    const record = await service.updateBranch({
      actor: input.actor,
      requestId: input.requestId,
      id,
      ...command,
    });
    return { data: toBranchResponseDto(record), request_id: input.requestId };
  },

  async deactivate(input: {
    actor: AuthenticatedActor;
    requestId: string;
    branchId: string;
    body: BranchDeactivateRequestDto;
  }): Promise<BranchDetailResponseDto> {
    const id = String(parseDecimalBigIntId(input.branchId, "branch_id"));
    const record = await service.deactivateBranch({
      actor: input.actor,
      requestId: input.requestId,
      id,
      reason: input.body.reason,
    });
    return { data: toBranchResponseDto(record), request_id: input.requestId };
  },
});

export type BranchController = ReturnType<typeof createBranchController>;
