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
import { branches } from "../branch/branch.schema";
import { rethrowOrganizationPersistenceError } from "../organization/organization.errors";
import type {
  DepartmentRecord,
  OrganizationExecutor,
  OrganizationPage,
  OrganizationVisibility,
  ParentFilteredPageInput,
} from "../organization/organization.types";
import { shops } from "../shop/shop.schema";
import { departments } from "./department.schema";

export interface DepartmentInsertInput {
  branchId: string;
  code: string;
  name: string;
}

export interface DepartmentUpdateInput {
  code?: string;
  name?: string;
}

export interface DepartmentRepositoryPort {
  findVisiblePage(
    executor: OrganizationExecutor,
    input: ParentFilteredPageInput,
    visibility: OrganizationVisibility,
  ): Promise<OrganizationPage<DepartmentRecord>>;
  findVisibleById(
    executor: OrganizationExecutor,
    id: string,
    visibility: OrganizationVisibility,
  ): Promise<DepartmentRecord | null>;
  findActiveParentChain(
    executor: OrganizationExecutor,
    branchId: string,
  ): Promise<boolean>;
  findById(
    executor: OrganizationExecutor,
    id: string,
  ): Promise<DepartmentRecord | null>;
  insert(
    executor: OrganizationExecutor,
    input: DepartmentInsertInput,
  ): Promise<DepartmentRecord>;
  update(
    executor: OrganizationExecutor,
    id: string,
    input: DepartmentUpdateInput,
  ): Promise<DepartmentRecord | null>;
  deactivate(
    executor: OrganizationExecutor,
    id: string,
  ): Promise<DepartmentRecord | null>;
}

const numericId = (value: string): number => {
  if (!/^[1-9][0-9]*$/.test(value)) throw new RangeError("Invalid database identifier");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new RangeError("Database identifier is outside the supported range");
  return parsed;
};

const toRecord = (row: typeof departments.$inferSelect): DepartmentRecord => ({
  id: String(row.id),
  branchId: String(row.branchId),
  code: row.code,
  name: row.name,
  isActive: row.isActive,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const escapeLike = (value: string): string =>
  value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");

export const departmentVisibilityCondition = (
  visibility: OrganizationVisibility,
): SQL | undefined => {
  if (visibility.all) return undefined;

  const alternatives: SQL[] = [];
  if (visibility.branchIds.length > 0) {
    alternatives.push(inArray(departments.branchId, visibility.branchIds.map(numericId)));
  }
  if (visibility.departmentIds.length > 0) {
    alternatives.push(inArray(departments.id, visibility.departmentIds.map(numericId)));
  }

  if (alternatives.length === 0) return sql`false`;
  if (alternatives.length === 1) return alternatives[0];
  return or(...alternatives);
};

const rowSelection = {
  id: departments.id,
  branchId: departments.branchId,
  code: departments.code,
  name: departments.name,
  isActive: departments.isActive,
  createdAt: departments.createdAt,
  updatedAt: departments.updatedAt,
};

export const departmentRepository: DepartmentRepositoryPort = {
  async findVisiblePage(executor, input, visibility) {
    const conditions: (SQL | undefined)[] = [
      eq(departments.isActive, input.isActive),
      departmentVisibilityCondition(visibility),
      input.parentId === null
        ? undefined
        : eq(departments.branchId, numericId(input.parentId)),
    ];
    if (input.search !== null) {
      const pattern = `%${escapeLike(input.search)}%`;
      conditions.push(or(ilike(departments.code, pattern), ilike(departments.name, pattern)));
    }
    const where = and(...conditions);

    const [rows, countRows] = await Promise.all([
      executor
        .select(rowSelection)
        .from(departments)
        .where(where)
        .orderBy(asc(departments.code), asc(departments.id))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize),
      executor
        .select({ total: sql<number>`count(*)` })
        .from(departments)
        .where(where),
    ]);

    return {
      items: rows.map(toRecord),
      page: input.page,
      pageSize: input.pageSize,
      total: Number(countRows[0]?.total ?? 0),
    };
  },

  async findVisibleById(executor, id, visibility) {
    const [row] = await executor
      .select(rowSelection)
      .from(departments)
      .where(and(
        eq(departments.id, numericId(id)),
        departmentVisibilityCondition(visibility),
      ))
      .limit(1);
    return row ? toRecord(row) : null;
  },

  async findActiveParentChain(executor, branchId) {
    const [row] = await executor
      .select({ id: branches.id })
      .from(branches)
      .innerJoin(shops, eq(shops.id, branches.shopId))
      .where(and(
        eq(branches.id, numericId(branchId)),
        eq(branches.isActive, true),
        eq(shops.isActive, true),
      ))
      .limit(1);
    return row !== undefined;
  },

  async findById(executor, id) {
    const [row] = await executor
      .select(rowSelection)
      .from(departments)
      .where(eq(departments.id, numericId(id)))
      .limit(1);
    return row ? toRecord(row) : null;
  },

  async insert(executor, input) {
    try {
      const [row] = await executor
        .insert(departments)
        .values({
          branchId: numericId(input.branchId),
          code: input.code,
          name: input.name,
        })
        .returning();
      if (!row) throw new Error("Department insert did not return a record");
      return toRecord(row);
    } catch (error) {
      return rethrowOrganizationPersistenceError(error);
    }
  },

  async update(executor, id, input) {
    try {
      const [row] = await executor
        .update(departments)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(departments.id, numericId(id)))
        .returning();
      return row ? toRecord(row) : null;
    } catch (error) {
      return rethrowOrganizationPersistenceError(error);
    }
  },

  async deactivate(executor, id) {
    const [row] = await executor
      .update(departments)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(
        eq(departments.id, numericId(id)),
        eq(departments.isActive, true),
      ))
      .returning();
    return row ? toRecord(row) : null;
  },
};
