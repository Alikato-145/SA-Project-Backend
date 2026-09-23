import type { AuthenticatedActor } from "../../core/auth/auth.types";
import {
  parseBooleanFilter,
  parseDecimalBigIntId,
  parseOptionalTrimmedText,
  parsePagination,
} from "../organization/organization.validation";
import type {
  CreateShopRequestDto,
  DeactivateShopRequestDto,
  ShopListQueryDto,
  UpdateShopRequestDto,
} from "./shop.dto";
import { toShopResponseDto } from "./shop.mapper";
import type { ShopService } from "./shop.service";

export const createShopController = (service: ShopService) => ({
  async list(input: {
    actor: AuthenticatedActor;
    requestId: string;
    query: ShopListQueryDto;
  }) {
    const pagination = parsePagination(input.query);
    const search = parseOptionalTrimmedText(input.query.search, "search", 150) ?? null;
    const page = await service.listShops({
      actor: input.actor,
      requestId: input.requestId,
      ...pagination,
      search,
      isActive: parseBooleanFilter(input.query.is_active, "is_active"),
    });
    return {
      data: page.items.map(toShopResponseDto),
      page: page.page,
      page_size: page.pageSize,
      total: page.total,
      request_id: input.requestId,
    };
  },

  async detail(input: {
    actor: AuthenticatedActor;
    requestId: string;
    shopId: string;
  }) {
    parseDecimalBigIntId(input.shopId, "shop_id");
    const record = await service.getShop(input);
    return { data: toShopResponseDto(record), request_id: input.requestId };
  },

  async create(input: {
    actor: AuthenticatedActor;
    requestId: string;
    body: CreateShopRequestDto;
  }) {
    const record = await service.createShop({
      actor: input.actor,
      requestId: input.requestId,
      code: input.body.code,
      name: input.body.name,
    });
    return { data: toShopResponseDto(record), request_id: input.requestId };
  },

  async update(input: {
    actor: AuthenticatedActor;
    requestId: string;
    shopId: string;
    body: UpdateShopRequestDto;
  }) {
    parseDecimalBigIntId(input.shopId, "shop_id");
    const record = await service.updateShop({
      actor: input.actor,
      requestId: input.requestId,
      shopId: input.shopId,
      code: input.body.code,
      name: input.body.name,
    });
    return { data: toShopResponseDto(record), request_id: input.requestId };
  },

  async deactivate(input: {
    actor: AuthenticatedActor;
    requestId: string;
    shopId: string;
    body: DeactivateShopRequestDto;
  }) {
    parseDecimalBigIntId(input.shopId, "shop_id");
    const record = await service.deactivateShop({
      actor: input.actor,
      requestId: input.requestId,
      shopId: input.shopId,
      reason: input.body.reason,
    });
    return { data: toShopResponseDto(record), request_id: input.requestId };
  },
});

export type ShopController = ReturnType<typeof createShopController>;
