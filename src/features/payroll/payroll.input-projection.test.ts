import { describe, expect, test } from "bun:test";

process.env.AUTH_JWT_SECRET ??= "payroll-input-test-secret-at-least-32-characters";
process.env.AUTH_ALLOWED_ORIGINS ??= "http://localhost:3000";
process.env.DATABASE_URL ??= "postgresql://postgres@localhost/haris_payroll";
const { payrollEffectiveOn, payrollInclusiveDates } = await import("./payroll.repository");

describe("payroll dated input projection", () => {
  test("uses explicit inclusive dates including leap day", () => {
    expect(payrollInclusiveDates("2028-02-28", "2028-03-01")).toEqual([
      "2028-02-28", "2028-02-29", "2028-03-01",
    ]);
  });

  test("resolves effective rows without bridging a history gap", () => {
    const rows = [
      { id: "old", effectiveFrom: "2026-01-01", effectiveTo: "2026-09-10" },
      { id: "new", effectiveFrom: "2026-09-12", effectiveTo: null },
    ];
    expect(payrollEffectiveOn(rows, "2026-09-10")?.id).toBe("old");
    expect(payrollEffectiveOn(rows, "2026-09-11")).toBeUndefined();
    expect(payrollEffectiveOn(rows, "2026-09-12")?.id).toBe("new");
  });
});
