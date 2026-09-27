import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { parseDecimalBigIntId } from "../organization/organization.validation";
import type {
  PositionCreateRequestDto,
  PositionDeactivateRequestDto,
  PositionListQueryDto,
  PositionUpdateRequestDto,
} from "./position.dto";
import {
  parseCreatePositionRequest,
  parseDeactivatePositionRequest,
  parsePositionListQuery,
  parseUpdatePositionRequest,
} from "./position.dto";
import {
  toPositionDetailResponseDto,
  toPositionListResponseDto,
} from "./position.mapper";
import type { PositionService } from "./position.service";

export const createPositionController = (service: PositionService) => ({
  async list(input: {
    actor: AuthenticatedActor;
    requestId: string;
    query: PositionListQueryDto;
  }) {
    const parsed = parsePositionListQuery(input.query);
    const result = await service.listPositions({
      actor: input.actor,
      requestId: input.requestId,
      ...parsed,
    });
    return toPositionListResponseDto(result, input.requestId);
  },

  async detail(input: {
    actor: AuthenticatedActor;
    requestId: string;
    positionId: unknown;
  }) {
    const positionId = String(
      parseDecimalBigIntId(input.positionId, "position_id"),
    );
    const record = await service.getPosition({
      actor: input.actor,
      requestId: input.requestId,
      positionId,
    });
    return toPositionDetailResponseDto(record, input.requestId);
  },

  async create(input: {
    actor: AuthenticatedActor;
    requestId: string;
    body: PositionCreateRequestDto;
  }) {
    const command = parseCreatePositionRequest(input.body);
    const record = await service.createPosition({
      actor: input.actor,
      requestId: input.requestId,
      ...command,
    });
    return toPositionDetailResponseDto(record, input.requestId);
  },

  async update(input: {
    actor: AuthenticatedActor;
    requestId: string;
    positionId: unknown;
    body: PositionUpdateRequestDto;
  }) {
    const id = String(parseDecimalBigIntId(input.positionId, "position_id"));
    const command = parseUpdatePositionRequest(input.body);
    const record = await service.updatePosition({
      actor: input.actor,
      requestId: input.requestId,
      id,
      ...command,
    });
    return toPositionDetailResponseDto(record, input.requestId);
  },

  async deactivate(input: {
    actor: AuthenticatedActor;
    requestId: string;
    positionId: unknown;
    body: PositionDeactivateRequestDto;
  }) {
    const id = String(parseDecimalBigIntId(input.positionId, "position_id"));
    const command = parseDeactivatePositionRequest(input.body);
    const record = await service.deactivatePosition({
      actor: input.actor,
      requestId: input.requestId,
      id,
      ...command,
    });
    return toPositionDetailResponseDto(record, input.requestId);
  },
});

export type PositionController = ReturnType<typeof createPositionController>;
