import type { DatabaseExecutor } from "../../core/db/transaction";

export type OrganizationExecutor = DatabaseExecutor;

export interface OrganizationPageInput {
  page: number;
  pageSize: number;
  search: string | null;
  isActive: boolean;
}

export interface OrganizationPage<T> {
  items: readonly T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface OrganizationVisibility {
  all: boolean;
  branchIds: readonly string[];
  departmentIds: readonly string[];
}

export interface ShopRecord {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface BranchRecord {
  id: string;
  shopId: string;
  code: string;
  name: string;
  address: string | null;
  timezone: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DepartmentRecord {
  id: string;
  branchId: string;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PositionRecord {
  id: string;
  shopId: string;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ParentFilteredPageInput extends OrganizationPageInput {
  parentId: string | null;
}

export interface DeactivateOrganizationInput {
  id: string;
  reason: string;
}
