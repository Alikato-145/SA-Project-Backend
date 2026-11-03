import { expect, test } from "bun:test";
import { sameLeavePolicy } from "./leave-consolidation";

test("only equivalent leave policies may share a canonical type", () => {
  const type = { nameTh: "ลาป่วย", quotaType: "fixed", quotaDays: "30.00", isDeductible: false, requiresDocument: false, allowExceed: false };
  expect(sameLeavePolicy(type, { ...type, quotaDays: "30" })).toBe(true);
  expect(sameLeavePolicy(type, { ...type, quotaDays: "20" })).toBe(false);
  expect(sameLeavePolicy(type, { ...type, requiresDocument: true })).toBe(false);
});
