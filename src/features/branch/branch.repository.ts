import {
  and,
  asc,
  count,
  eq,
  exists,
  ilike,
  inArray,
  or,
  type SQL,
} from "drizzle-orm";
import { ApplicationError } from "../../core/errors/application.error";
import type {
  BranchRecord,
  OrganizationExecutor,
  OrganizationPage,
  OrganizationVisibility,
  ParentFilteredPageInput,
} from "../organization/organization.types";
import { departments } from "../department/department.schema";
import { shops } from "../shop/shop.schema";
import { branches } from "./branch.schema";

export interface BranchInsertInput {
  shopId: string;
  code: string;
  name: string;
  address: string | null;
  timezone: string;
}

export interface BranchUpdateInput {
  code?: string;
  name?: string;
  address?: string | null;
  timezone?: string;
}

export interface BranchReadPageInput extends ParentFilteredPageInput {
  visibility: OrganizationVisibility;
}

export interface BranchRepositoryPort {
  findPage(
    executor: OrganizationExecutor,
    input: BranchReadPageInput,
  ): Promise<OrganizationPage<BranchRecord>>;
  findVisibleById(
    executor: OrganizationExecutor,
    id: string,
    visibility: OrganizationVisibility,
  ): Promise<BranchRecord | null>;
  findActiveShop(
    executor: OrganizationExecutor,
    shopId: string,
  ): Promise<boolean>;
  findById(
    executor: OrganizationExecutor,
    id: string,
  ): Promise<BranchRecord | null>;
  insert(
    executor: OrganizationExecutor,
    input: BranchInsertInput,
  ): Promise<BranchRecord>;
  update(
    executor: OrganizationExecutor,
    id: string,
    input: BranchUpdateInput,
  ): Promise<BranchRecord | null>;
  deactivate(
    executor: OrganizationExecutor,
    id: string,
  ): Promise<BranchRecord | null>;
}

const numericId = (value: string): number => {
  if (!/^[1-9]\d*$/.test(value)) throw new RangeError("Invalid database identifier");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError("Database identifier is outside the supported range");
  }
  return parsed;
};

const toRecord = (row: typeof branches.$inferSelect): BranchRecord => ({
  ...row,
  id: String(row.id),
  shopId: String(row.shopId),
});

const isUniqueViolation = (error: unknown): boolean => {
  let candidate: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) return false;
    if ((candidate as { code?: unknown }).code === "23505") return true;
    candidate = (candidate as { cause?: unknown }).cause;
  }
  return false;
};

const translateWriteError = (error: unknown): never => {
  if (isUniqueViolation(error)) {
    throw new ApplicationError("DUPLICATE_CODE", { cause: error });
  }
  throw error;
};

/**
 * Department grants deliberately resolve their parent through the department
 * row. The branch ID carried beside a supervisor grant is not trusted to widen
 * visibility, and sibling branches/departments are never inferred.
 */
const visibilityCondition = (
  executor: OrganizationExecutor,
  visibility: OrganizationVisibility,
): SQL | undefined => {
  if (visibility.all) return undefined;

  const alternatives: SQL[] = [];
  if (visibility.branchIds.length > 0) {
    alternatives.push(
      inArray(branches.id, visibility.branchIds.map(numericId)),
    );
  }
  if (visibility.departmentIds.length > 0) {
    alternatives.push(
      exists(
        executor
          .select({ id: departments.id })
          .from(departments)
          .where(
            and(
              eq(departments.branchId, branches.id),
              inArray(departments.id, visibility.departmentIds.map(numericId)),
            ),
          ),
      ),
    );
  }

  if (alternatives.length === 0) return undefined;
  return alternatives.length === 1 ? alternatives[0] : or(...alternatives);
};

const cannotSeeAnything = (visibility: OrganizationVisibility): boolean =>
  !visibility.all &&
  visibility.branchIds.length === 0 &&
  visibility.departmentIds.length === 0;

export const branchRepository: BranchRepositoryPort = {
  async findPage(executor, input) {
    if (cannotSeeAnything(input.visibility)) {
      return {
        items: [],
        page: input.page,
        pageSize: input.pageSize,
        total: 0,
      };
    }

    const conditions: SQL[] = [eq(branches.isActive, input.isActive)];
    const scope = visibilityCondition(executor, input.visibility);
    if (scope) conditions.push(scope);
    if (input.parentId !== null) {
      conditions.push(eq(branches.shopId, numericId(input.parentId)));
    }
    if (input.search !== null) {
      const pattern = `%${input.search}%`;
      conditions.push(or(ilike(branches.code, pattern), ilike(branches.name, pattern))!);
    }
    const where = and(...conditions);

    const [rows, totals] = await Promise.all([
      executor
        .select()
        .from(branches)
        .where(where)
        .orderBy(asc(branches.code), asc(branches.id))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize),
      executor.select({ value: count() }).from(branches).where(where),
    ]);

    return {
      items: rows.map(toRecord),
      page: input.page,
      pageSize: input.pageSize,
      total: Number(totals[0]?.value ?? 0),
    };
  },

  async findVisibleById(executor, id, visibility) {
    if (cannotSeeAnything(visibility)) return null;

    const conditions: SQL[] = [eq(branches.id, numericId(id))];
    const scope = visibilityCondition(executor, visibility);
    if (scope) conditions.push(scope);
    const [row] = await executor
      .select()
      .from(branches)
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
      .from(branches)
      .where(eq(branches.id, numericId(id)))
      .limit(1);
    return row ? toRecord(row) : null;
  },

  async insert(executor, input) {
    try {
      const [row] = await executor
        .insert(branches)
        .values({
          shopId: numericId(input.shopId),
          code: input.code,
          name: input.name,
          address: input.address,
          timezone: input.timezone,
        })
        .returning();
      if (!row) throw new Error("Branch insert did not return a record");
      return toRecord(row);
    } catch (error) {
      return translateWriteError(error);
    }
  },

  async update(executor, id, input) {
    try {
      const [row] = await executor
        .update(branches)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(branches.id, numericId(id)))
        .returning();
      return row ? toRecord(row) : null;
    } catch (error) {
      return translateWriteError(error);
    }
  },

  async deactivate(executor, id) {
    const [row] = await executor
      .update(branches)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(
        eq(branches.id, numericId(id)),
        eq(branches.isActive, true),
      ))
      .returning();
    return row ? toRecord(row) : null;
  },
};
