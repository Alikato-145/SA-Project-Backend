import { afterAll, describe, expect, test } from "bun:test";
import { closeDatabase, db } from "../../core/db/client";
import { branches } from "../branch/branch.schema";
import { shops } from "../shop/shop.schema";
import { departments } from "./department.schema";
import { departmentRepository } from "./department.repository";

const databaseTest = process.env.A2_DATABASE_INTEGRATION === "1" ? test : test.skip;

describe("department repository database scope", () => {
  databaseTest("intersects list/detail queries with branch-wide and exact-department visibility", async () => {
    const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 8);

    await expect(db.transaction(async (executor) => {
      const [shop] = await executor.insert(shops).values({
        code: `DS${suffix}`,
        name: "Department scope shop",
      }).returning();
      const insertedBranches = await executor.insert(branches).values([
        { shopId: shop!.id, code: `D1${suffix}`, name: "Branch one" },
        { shopId: shop!.id, code: `D2${suffix}`, name: "Branch two" },
      ]).returning();
      const insertedDepartments = await executor.insert(departments).values([
        { branchId: insertedBranches[0]!.id, code: `DA${suffix}`, name: "Alpha" },
        { branchId: insertedBranches[0]!.id, code: `DB${suffix}`, name: "Beta", isActive: false },
        { branchId: insertedBranches[1]!.id, code: `DC${suffix}`, name: "Gamma" },
      ]).returning();

      const branchVisibility = {
        all: false,
        branchIds: [String(insertedBranches[0]!.id)],
        departmentIds: [],
      };
      const active = await departmentRepository.findVisiblePage(executor, {
        page: 1,
        pageSize: 20,
        search: null,
        isActive: true,
        parentId: null,
      }, branchVisibility);
      expect(active.items.map(({ id }) => id)).toEqual([String(insertedDepartments[0]!.id)]);
      expect(active.total).toBe(1);

      const inactive = await departmentRepository.findVisiblePage(executor, {
        page: 1,
        pageSize: 20,
        search: "Beta",
        isActive: false,
        parentId: String(insertedBranches[0]!.id),
      }, branchVisibility);
      expect(inactive.items.map(({ id }) => id)).toEqual([String(insertedDepartments[1]!.id)]);

      const exactVisibility = {
        all: false,
        branchIds: [],
        departmentIds: [String(insertedDepartments[2]!.id)],
      };
      expect(await departmentRepository.findVisibleById(
        executor,
        String(insertedDepartments[2]!.id),
        exactVisibility,
      )).not.toBeNull();
      expect(await departmentRepository.findVisibleById(
        executor,
        String(insertedDepartments[0]!.id),
        exactVisibility,
      )).toBeNull();

      throw new Error("ROLLBACK_DEPARTMENT_READ_TEST");
    })).rejects.toThrow("ROLLBACK_DEPARTMENT_READ_TEST");
  });
});

afterAll(async () => {
  if (process.env.A2_DATABASE_INTEGRATION === "1") await closeDatabase();
});
