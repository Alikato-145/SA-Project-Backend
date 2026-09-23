import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { closeDatabase, db } from "../../core/db/client";
import { branches } from "../branch/branch.schema";
import { branchRepository } from "../branch/branch.repository";
import { departments } from "../department/department.schema";
import { departmentRepository } from "../department/department.repository";
import { positions } from "../position/position.schema";
import { positionRepository } from "../position/position.repository";
import { shops } from "../shop/shop.schema";
import { shopRepository } from "../shop/shop.repository";

const databaseTest = process.env.A2_DATABASE_INTEGRATION === "1" ? test : test.skip;

describe("organization historical persistence", () => {
  databaseTest("keeps children and parent identifiers when every resource is deactivated", async () => {
    const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();

    await expect(db.transaction(async (executor) => {
      const [shop] = await executor.insert(shops).values({
        code: `HS${suffix}`, name: "Historical shop",
      }).returning();
      if (!shop) throw new Error("Shop fixture was not inserted");
      const [branch] = await executor.insert(branches).values({
        shopId: shop.id, code: `HB${suffix}`, name: "Historical branch",
      }).returning();
      if (!branch) throw new Error("Branch fixture was not inserted");
      const [department] = await executor.insert(departments).values({
        branchId: branch.id, code: `HD${suffix}`, name: "Historical department",
      }).returning();
      const [position] = await executor.insert(positions).values({
        shopId: shop.id, code: `HP${suffix}`, name: "Historical position",
      }).returning();
      if (!department || !position) throw new Error("Child fixtures were not inserted");

      const shopId = String(shop.id);
      const branchId = String(branch.id);
      const departmentId = String(department.id);
      const positionId = String(position.id);

      expect(await shopRepository.deactivate(executor, shopId))
        .toMatchObject({ id: shopId, isActive: false });

      const storedBranches = await executor.select().from(branches)
        .where(eq(branches.id, branch.id));
      const storedDepartments = await executor.select().from(departments)
        .where(eq(departments.id, department.id));
      const storedPositions = await executor.select().from(positions)
        .where(eq(positions.id, position.id));
      expect(storedBranches).toEqual([
        expect.objectContaining({ id: branch.id, shopId: shop.id, isActive: true }),
      ]);
      expect(storedDepartments).toEqual([
        expect.objectContaining({ id: department.id, branchId: branch.id, isActive: true }),
      ]);
      expect(storedPositions).toEqual([
        expect.objectContaining({ id: position.id, shopId: shop.id, isActive: true }),
      ]);

      expect(await branchRepository.findActiveShop(executor, shopId)).toBe(false);
      expect(await departmentRepository.findActiveParentChain(executor, branchId)).toBe(false);
      expect(await positionRepository.findActiveShop(executor, shopId)).toBe(false);

      expect(await branchRepository.deactivate(executor, branchId))
        .toMatchObject({ id: branchId, shopId, isActive: false });
      expect(await departmentRepository.deactivate(executor, departmentId))
        .toMatchObject({ id: departmentId, branchId, isActive: false });
      expect(await positionRepository.deactivate(executor, positionId))
        .toMatchObject({ id: positionId, shopId, isActive: false });

      expect(await shopRepository.deactivate(executor, shopId)).toBeNull();
      expect(await branchRepository.deactivate(executor, branchId)).toBeNull();
      expect(await departmentRepository.deactivate(executor, departmentId)).toBeNull();
      expect(await positionRepository.deactivate(executor, positionId)).toBeNull();

      expect(await shopRepository.findById(
        executor,
        shopId,
        { all: true, branchIds: [], departmentIds: [] },
      )).toMatchObject({ id: shopId, isActive: false });
      expect(await branchRepository.findById(executor, branchId))
        .toMatchObject({ id: branchId, shopId, isActive: false });
      expect(await departmentRepository.findById(executor, departmentId))
        .toMatchObject({ id: departmentId, branchId, isActive: false });
      expect(await positionRepository.findById(executor, positionId))
        .toMatchObject({ id: positionId, shopId, isActive: false });

      throw new Error("ROLLBACK_ORGANIZATION_HISTORY_TEST");
    })).rejects.toThrow("ROLLBACK_ORGANIZATION_HISTORY_TEST");
  });
});

afterAll(async () => {
  if (process.env.A2_DATABASE_INTEGRATION === "1") await closeDatabase();
});
