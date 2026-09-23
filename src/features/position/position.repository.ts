import {
  and,
  asc,
  eq,
  ilike,
  inArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { DatabaseExecutor } from "../../core/db/transaction";
import { rethrowOrganizationPersistenceError } from "../organization/organization.errors";
import { shops } from "../shop/shop.schema";
import { branches } from "../branch/branch.schema";
import { departments } from "../department/department.schema";
import type {
  OrganizationPage,
  OrganizationVisibility,
  ParentFilteredPageInput,
  PositionRecord,
} from "../organization/organization.types";
import { positions } from "./position.schema";

export interface PositionRepositoryPort {
  /** null means unrestricted all-scope; an empty array means fail closed. */
  resolveVisibleShopIds(
    executor: DatabaseExecutor,
    visibility: OrganizationVisibility,
  ): Promise<readonly string[] | null>;
  findPage(
    executor: DatabaseExecutor,
    input: ParentFilteredPageInput,
    visibleShopIds: readonly string[] | null,
  ): Promise<OrganizationPage<PositionRecord>>;
  findVisibleById(
    executor: DatabaseExecutor,
    id: string,
    visibleShopIds: readonly string[] | null,
  ): Promise<PositionRecord | null>;
  findActiveShop(executor: DatabaseExecutor, shopId: string): Promise<boolean>;
  findById(executor: DatabaseExecutor, id: string): Promise<PositionRecord | null>;
  insert(
    executor: DatabaseExecutor,
    input: { shopId: string; code: string; name: string },
  ): Promise<PositionRecord>;
  update(
    executor: DatabaseExecutor,
    id: string,
    input: { code?: string; name?: string },
  ): Promise<PositionRecord | null>;
  deactivate(
    executor: DatabaseExecutor,
    id: string,
  ): Promise<PositionRecord | null>;
}

const numericId = (value: string): number => {
  if (!/^[1-9]\d*$/.test(value)) throw new RangeError("Invalid database identifier");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError("Database identifier is outside the supported range");
  }
  return parsed;
};

const toRecord = (row: typeof positions.$inferSelect): PositionRecord => ({
  id: String(row.id),
  shopId: String(row.shopId),
  code: row.code,
  name: row.name,
  isActive: row.isActive,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const visibilityCondition = (
  visibleShopIds: readonly string[] | null,
): SQL | undefined => {
  if (visibleShopIds === null) return undefined;
  if (visibleShopIds.length === 0) return sql`false`;
  return inArray(positions.shopId, visibleShopIds.map(numericId));
};

const pageConditions = (
  input: ParentFilteredPageInput,
  visibleShopIds: readonly string[] | null,
): SQL[] => {
  const conditions: SQL[] = [eq(positions.isActive, input.isActive)];
  const scope = visibilityCondition(visibleShopIds);
  if (scope) conditions.push(scope);
  if (input.parentId !== null) {
    conditions.push(eq(positions.shopId, numericId(input.parentId)));
  }
  if (input.search !== null) {
    const pattern = `%${input.search}%`;
    conditions.push(or(ilike(positions.code, pattern), ilike(positions.name, pattern))!);
  }
  return conditions;
};

export const positionRepository: PositionRepositoryPort = {
  async resolveVisibleShopIds(executor, visibility) {
    if (visibility.all) return null;

    const shopIds = new Set<string>();
    if (visibility.branchIds.length > 0) {
      const rows = await executor
        .select({ shopId: branches.shopId })
        .from(branches)
        .where(inArray(branches.id, visibility.branchIds.map(numericId)));
      for (const row of rows) shopIds.add(String(row.shopId));
    }

    if (visibility.departmentIds.length > 0) {
      const rows = await executor
        .select({ shopId: branches.shopId })
        .from(departments)
        .innerJoin(branches, eq(branches.id, departments.branchId))
        .where(inArray(departments.id, visibility.departmentIds.map(numericId)));
      for (const row of rows) shopIds.add(String(row.shopId));
    }

    return [...shopIds];
  },

  async findPage(executor, input, visibleShopIds) {
    if (visibleShopIds !== null && visibleShopIds.length === 0) {
      return { items: [], page: input.page, pageSize: input.pageSize, total: 0 };
    }

    const where = and(...pageConditions(input, visibleShopIds));
    const offset = (input.page - 1) * input.pageSize;
    const [rows, countRows] = await Promise.all([
      executor
        .select()
        .from(positions)
        .where(where)
        .orderBy(asc(positions.code), asc(positions.id))
        .limit(input.pageSize)
        .offset(offset),
      executor
        .select({ count: sql<number>`count(*)` })
        .from(positions)
        .where(where),
    ]);

    return {
      items: rows.map(toRecord),
      page: input.page,
      pageSize: input.pageSize,
      total: Number(countRows[0]?.count ?? 0),
    };
  },

  async findVisibleById(executor, id, visibleShopIds) {
    if (visibleShopIds !== null && visibleShopIds.length === 0) return null;
    const conditions: SQL[] = [eq(positions.id, numericId(id))];
    const scope = visibilityCondition(visibleShopIds);
    if (scope) conditions.push(scope);
    const [row] = await executor
      .select()
      .from(positions)
      .where(and(...conditions))
      .limit(1);
    return row ? toRecord(row) : null;
  },

  async findActiveShop(executor, shopId) {
    const [row] = await executor
      .select({ id: shops.id })
      .from(shops)
      .where(and(eq(shops.id, numericId(shopId)), eq(shops.isActive, true)))
      .limit(1);
    return row !== undefined;
  },

  async findById(executor, id) {
    const [row] = await executor
      .select()
      .from(positions)
      .where(eq(positions.id, numericId(id)))
      .limit(1);
    return row ? toRecord(row) : null;
  },

  async insert(executor, input) {
    try {
      const [row] = await executor
        .insert(positions)
        .values({
          shopId: numericId(input.shopId),
          code: input.code,
          name: input.name,
        })
        .returning();
      if (!row) throw new Error("Position insert did not return a record");
      return toRecord(row);
    } catch (error) {
      return rethrowOrganizationPersistenceError(error);
    }
  },

  async update(executor, id, input) {
    try {
      const [row] = await executor
        .update(positions)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(positions.id, numericId(id)))
        .returning();
      return row ? toRecord(row) : null;
    } catch (error) {
      return rethrowOrganizationPersistenceError(error);
    }
  },

  async deactivate(executor, id) {
    const [row] = await executor
      .update(positions)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(
        eq(positions.id, numericId(id)),
        eq(positions.isActive, true),
      ))
      .returning();
    return row ? toRecord(row) : null;
  },
};
