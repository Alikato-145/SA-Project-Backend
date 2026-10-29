import { expect, test } from "bun:test";
import { allocateByEarnedBase } from "./branch-allocation";

test("shares monthly social security in proportion to branch earned base, preserving exact satang", () => {
  expect(allocateByEarnedBase(75000n, [{ branchId: "1", earnedBase: 1000000n }, { branchId: "2", earnedBase: 2000000n }])).toEqual([{ branchId: "1", amount: 25000n }, { branchId: "2", amount: 50000n }]);
});
test("assigns residual satang deterministically and ignores input ordering", () => {
  const a = [{ branchId: "2", earnedBase: 100n }, { branchId: "1", earnedBase: 100n }, { branchId: "3", earnedBase: 100n }];
  expect(allocateByEarnedBase(100n, a)).toEqual([{ branchId: "1", amount: 34n }, { branchId: "2", amount: 33n }, { branchId: "3", amount: 33n }]);
  expect(allocateByEarnedBase(100n, [...a].reverse())).toEqual(allocateByEarnedBase(100n, a));
});
test("handles zero base and rejects invalid inputs", () => {
  expect(allocateByEarnedBase(0n, [{ branchId: "1", earnedBase: 0n }])).toEqual([{ branchId: "1", amount: 0n }]);
  expect(() => allocateByEarnedBase(1n, [{ branchId: "1", earnedBase: 0n }])).toThrow();
  expect(() => allocateByEarnedBase(1n, [{ branchId: "1", earnedBase: 1n }, { branchId: "1", earnedBase: 2n }])).toThrow();
});
