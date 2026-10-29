import { expect, test } from "bun:test";
import { countMonthlyWorkDays } from "./monthly-workdays";

test("subtracts overlapping weekly, public and branch holidays only once", () => {
  const days = Array.from({ length: 30 }, (_, index) => `2026-04-${String(index + 1).padStart(2, "0")}`);
  expect(countMonthlyWorkDays(days, {
    weekly: [{ weekday: 0, effectiveFrom: "2026-04-01", effectiveTo: null }],
    publicDates: ["2026-04-05", "2026-04-13"], closedDates: ["2026-04-13", "2026-04-14"],
  })).toBe(24);
});

test("honors effective ranges and leap-day calendar dates", () => {
  const days = ["2028-02-27", "2028-02-28", "2028-02-29"];
  expect(countMonthlyWorkDays(days, { weekly: [{ weekday: 0, effectiveFrom: "2028-02-28", effectiveTo: null }], publicDates: [], closedDates: ["2028-02-29"] })).toBe(2);
});
