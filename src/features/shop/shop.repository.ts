import { and, asc, count, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { DatabaseExecutor } from "../../core/db/transaction";
import { branches } from "../branch/branch.schema";
import { departments } from "../department/department.schema";
import type {
  OrganizationPage,
  OrganizationPageInput,
  OrganizationVisibility,
  ShopRecord,
} from "../organization/organization.types";
import { rethrowOrganizationPersistenceError } from "../organization/organization.errors";
import { shops } from "./shop.schema";

export interface ShopRepositoryPort {
  list(
    executor: DatabaseExecutor,
    query: OrganizationPageInput,
    visibility: OrganizationVisibility,
  ): Promise<OrganizationPage<ShopRecord>>;
  findById(
    executor: DatabaseExecutor,
    shopId: string,
    visibility: OrganizationVisibility,
  ): Promise<ShopRecord | null>;
  insert(
    executor: DatabaseExecutor,
    input: { code: string; name: string },
  ): Promise<ShopRecord>;
  update(
    executor: DatabaseExecutor,
    shopId: string,
    input: { code?: string; name?: string },
  ): Promise<ShopRecord | null>;
  deactivate(
    executor: DatabaseExecutor,
    shopId: string,
  ): Promise<ShopRecord | null>;
}

const numericId = (value: string): number => {
  if (!/^[1-9]\d*$/.test(value)) throw new RangeError("Invalid database identifier");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new RangeError("Database identifier is outside the supported range");
  return parsed;
};

const project = (row: typeof shops.$inferSelect): ShopRecord => ({
  ...row,
  id: String(row.id),
});

const visibilityFilter = (visibility: OrganizationVisibility) => {
  if (visibility.all) return undefined;

  const filters = [];
  if (visibility.branchIds.length > 0) {
    const branchIds = visibility.branchIds.map(numericId);
    filters.push(sql`exists (
      select 1 from ${branches}
      where ${branches.shopId} = ${shops.id}
        and ${inArray(branches.id, branchIds)}
    )`);
  }
  if (visibility.departmentIds.length > 0) {
    const departmentIds = visibility.departmentIds.map(numericId);
    filters.push(sql`exists (
      select 1 from ${departments}
      inner join ${branches} on ${branches.id} = ${departments.branchId}
      where ${branches.shopId} = ${shops.id}
        and ${inArray(departments.id, departmentIds)}
    )`);
  }
  return filters.length === 0 ? sql`false` : or(...filters);
};

const listFilter = (
  query: OrganizationPageInput,
  visibility: OrganizationVisibility,
) => {
  const filters = [eq(shops.isActive, query.isActive)];
  const scoped = visibilityFilter(visibility);
  if (scoped) filters.push(scoped);
  if (query.search) {
    const pattern = `%${query.search}%`;
    filters.push(or(ilike(shops.code, pattern), ilike(shops.name, pattern))!);
  }
  return and(...filters);
};

export const shopRepository: ShopRepositoryPort = {
  async list(executor, query, visibility) {
    const where = listFilter(query, visibility);
    const offset = (query.page - 1) * query.pageSize;
    const rows = await executor.select().from(shops).where(where)
      .orderBy(asc(shops.code), asc(shops.id))
      .limit(query.pageSize).offset(offset);
    const [totalRow] = await executor.select({ value: count() }).from(shops).where(where);
    return {
      items: rows.map(project),
      page: query.page,
      pageSize: query.pageSize,
      total: Number(totalRow?.value ?? 0),
    };
  },

  async findById(executor, shopId, visibility) {
    const filters = [eq(shops.id, numericId(shopId))];
    const scoped = visibilityFilter(visibility);
    if (scoped) filters.push(scoped);
    const [row] = await executor.select().from(shops).where(and(...filters)).limit(1);
    return row ? project(row) : null;
  },

  async insert(executor, input) {
    try {
      const [row] = await executor.insert(shops).values(input).returning();
      if (!row) throw new Error("Shop insert did not return a row");
      return project(row);
    } catch (error) {
      return rethrowOrganizationPersistenceError(error);
    }
  },

  async update(executor, shopId, input) {
    try {
      const [row] = await executor.update(shops).set({
        ...input,
        updatedAt: new Date(),
      }).where(eq(shops.id, numericId(shopId))).returning();
      return row ? project(row) : null;
    } catch (error) {
      return rethrowOrganizationPersistenceError(error);
    }
  },

  async deactivate(executor, shopId) {
    const [row] = await executor.update(shops).set({
      isActive: false,
      updatedAt: new Date(),
    }).where(and(
      eq(shops.id, numericId(shopId)),
      eq(shops.isActive, true),
    )).returning();
    return row ? project(row) : null;
  },
};
