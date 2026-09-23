export interface ShopResponseDto {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ShopListQueryDto {
  page?: string;
  page_size?: string;
  search?: string;
  is_active?: string;
}

export interface CreateShopRequestDto {
  code: string;
  name: string;
}

export interface UpdateShopRequestDto {
  code?: string;
  name?: string;
}

export interface DeactivateShopRequestDto {
  reason: unknown;
}
