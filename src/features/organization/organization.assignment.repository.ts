import { and, eq } from "drizzle-orm";
import type { DatabaseExecutor } from "../../core/db/transaction";
import { branches } from "../branch/branch.schema";
import { departments } from "../department/department.schema";
import { positions } from "../position/position.schema";
import { shops } from "../shop/shop.schema";

const id = (value: string): number => { const parsed = Number(value); if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(parsed)) throw new RangeError("Invalid ID"); return parsed; };
export interface AssignmentOrganizationPathRepository {
  isActivePath(executor: DatabaseExecutor, path: { branchId: string; departmentId: string; positionId: string }): Promise<boolean>;
}
export const assignmentOrganizationPathRepository: AssignmentOrganizationPathRepository = {
  async isActivePath(executor, path) {
    const [row] = await executor.select({ branchId: branches.id }).from(branches)
      .innerJoin(shops, eq(shops.id, branches.shopId))
      .innerJoin(departments, and(eq(departments.branchId, branches.id), eq(departments.id, id(path.departmentId))))
      .innerJoin(positions, and(eq(positions.shopId, shops.id), eq(positions.id, id(path.positionId))))
      .where(and(eq(branches.id, id(path.branchId)), eq(branches.isActive, true), eq(shops.isActive, true), eq(departments.isActive, true), eq(positions.isActive, true))).limit(1);
    return row !== undefined;
  },
};
