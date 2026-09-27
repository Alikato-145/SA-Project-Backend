import { describe, expect, test } from "bun:test";
import { createPayrollService } from "./payroll.service";
import { createPayrollHarness, payrollActor } from "./payroll.test-support";
import { calculationFixture } from "./payroll.test-support";

describe("payroll preview", () => {
  test("is repeatable and never settles finance sources", async () => {
    const harness = createPayrollHarness();
    const service = createPayrollService(harness);
    const first = await service.previewPayrollPeriod(payrollActor(), "20", "preview-1");
    const second = await service.previewPayrollPeriod(payrollActor(), "20", "preview-2");
    expect(first.records).toEqual(second.records);
    expect(harness.calls.replace).toBe(2);
    expect(harness.calls.settle).toBe(0);
    expect(harness.calls.audit).toEqual(["payroll.period.preview", "payroll.period.preview"]);
  });

  test("reports blockers without persisting partial preview", async () => {
    const harness = createPayrollHarness({ load: { blockers: [{ code: "PAYROLL_ATTENDANCE_INCOMPLETE", employeeId: "10", detail: "Missing day" }] } });
    const result = await createPayrollService(harness).previewPayrollPeriod(payrollActor(), "20", "blocked");
    expect(result.blockers[0].code).toBe("PAYROLL_ATTENDANCE_INCOMPLETE");
    expect(harness.calls.replace).toBe(0);
  });

  test("reports pending approvals and negative net", async () => {
    const negative = createPayrollHarness().inputs;
    const inputHarness = createPayrollHarness({ load: { pendingApprovals: true } });
    expect((await createPayrollService(inputHarness).previewPayrollPeriod(payrollActor(), "20", "pending")).blockers)
      .toContainEqual(expect.objectContaining({ code: "PAYROLL_APPROVALS_PENDING" }));
    expect(negative).toBeDefined();
  });

  test("calculates a bounded 500-employee fixture deterministically within five seconds", async () => {
    const harness = createPayrollHarness();
    const inputs = Array.from({ length: 500 }, (_, index) => ({
      ...calculationFixture(), employeeId: String(index + 1), assignmentId: String(index + 1001),
    }));
    harness.inputs.load = async () => ({ inputs, blockers: [], pendingApprovals: false });
    const started = performance.now();
    const result = await createPayrollService(harness).previewPayrollPeriod(payrollActor(), "20", "performance");
    expect(result.records).toHaveLength(500);
    expect(new Set(result.records.map((record) => record.employeeId)).size).toBe(500);
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});
