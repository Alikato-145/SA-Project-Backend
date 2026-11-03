import { expect, test } from "bun:test";
import { presentationBranches, presentationEmployees } from "./presentation-data";

test("presentation has twenty named employees in each real branch", () => {
  expect(presentationBranches.map((b) => b.name)).toEqual(["สาขารามอินทรา", "สาขาปากเกร็ด", "สาขานนทบุรี"]);
  for (const branch of presentationBranches) {
    const staff = presentationEmployees.filter((person) => person.branchCode === branch.code);
    expect(staff).toHaveLength(20);
    expect(staff.every((person) => person.firstName && person.lastName)).toBe(true);
  }
  expect(new Set(presentationEmployees.map((person) => person.code)).size).toBe(60);
});
