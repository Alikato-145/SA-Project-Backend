export type BranchEarnedBase = { branchId: string; earnedBase: bigint };

/** Allocate a monthly amount exactly; tied remainders go to the lowest branch ID. */
export function allocateByEarnedBase(total: bigint, branches: readonly BranchEarnedBase[]): { branchId: string; amount: bigint }[] {
  if (total < 0n || branches.some(row => !/^[1-9]\d*$/.test(row.branchId) || row.earnedBase < 0n) || new Set(branches.map(row => row.branchId)).size !== branches.length) throw new RangeError("Invalid branch allocation");
  const base = branches.reduce((sum, row) => sum + row.earnedBase, 0n);
  if (base === 0n && total !== 0n) throw new RangeError("Cannot allocate without earned base");
  const result = branches.map(row => ({ branchId: row.branchId, amount: base ? total * row.earnedBase / base : 0n, remainder: base ? total * row.earnedBase % base : 0n }));
  const byId = (a: { branchId: string }, b: { branchId: string }) => BigInt(a.branchId) < BigInt(b.branchId) ? -1 : BigInt(a.branchId) > BigInt(b.branchId) ? 1 : 0;
  const remainder = total - result.reduce((sum, row) => sum + row.amount, 0n);
  const ranked = [...result].sort((a,b) => a.remainder === b.remainder ? byId(a,b) : a.remainder > b.remainder ? -1 : 1);
  for (let index = 0; index < Number(remainder); index++) ranked[index]!.amount += 1n;
  return result.sort(byId).map(({ branchId, amount }) => ({ branchId, amount }));
}
