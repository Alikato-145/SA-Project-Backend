import { describe, expect, test } from "bun:test";
import { parseCreateBranchRequest } from "../branch/branch.dto";
import { parseCreateDepartmentRequest } from "../department/department.dto";
import { parseCreatePositionRequest } from "../position/position.dto";

describe("organization creation without a manually entered code", () => {
  test("accepts branch, department and position names without codes", () => {
    expect(parseCreateBranchRequest({ shop_id: "1", name: "Branch" })).toMatchObject({ shopId: "1", name: "Branch" });
    expect(parseCreateDepartmentRequest({ branch_id: "1", name: "Department" })).toMatchObject({ branchId: "1", name: "Department" });
    expect(parseCreatePositionRequest({ shop_id: "1", name: "Position" })).toMatchObject({ shopId: "1", name: "Position" });
  });
});

const databaseTest = process.env.TEST_DATABASE_URL ? test : test.skip;

databaseTest("generates identity-based codes for all four types and preserves legacy codes", async () => {
  const { db, closeDatabase } = await import("../../core/db/client");
  const { shopRepository } = await import("../shop/shop.repository");
  const { branchRepository } = await import("../branch/branch.repository");
  const { departmentRepository } = await import("../department/department.repository");
  const { positionRepository } = await import("../position/position.repository");
  try {
    const { sql } = await import("drizzle-orm");
    const sequence = await db.execute(sql`select nextval(pg_get_serial_sequence('shops', 'id'))::text as id`);
    const legacyCode = String(Number(sequence.rows[0]?.id) + 2);
    const legacy = await shopRepository.insert(db, { code: legacyCode, name: "Legacy" });
    const shop = await shopRepository.insert(db, { name: "Auto shop" });
    expect(legacy.code).toBe(legacyCode);
    expect(shop.code).toBe(shop.id);
    expect(Number(shop.id)).toBeGreaterThan(Number(legacyCode));
    const branch = await branchRepository.insert(db, { shopId: shop.id, name: "Auto branch", address: null, timezone: "Asia/Bangkok" });
    const department = await departmentRepository.insert(db, { branchId: branch.id, name: "Auto department" });
    const position = await positionRepository.insert(db, { shopId: shop.id, name: "Auto position" });
    for (const row of [branch, department, position]) expect(row.code).toBe(row.id);
    const [first, second] = await Promise.all([
      shopRepository.insert(db, { name: "Concurrent 1" }),
      shopRepository.insert(db, { name: "Concurrent 2" }),
    ]);
    expect(first.code).toBe(first.id);
    expect(second.code).toBe(second.id);
    expect(first.id).not.toBe(second.id);
  } finally {
    await closeDatabase();
  }
});
