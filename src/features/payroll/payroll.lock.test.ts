import { describe, expect, test } from "bun:test";
import { createPayrollService } from "./payroll.service";
import { calculationFixture, createPayrollHarness, payrollActor, periodFixture } from "./payroll.test-support";

describe("payroll lock", () => {
  test("recalculates, freezes, settles once, and audits", async () => {
    const harness = createPayrollHarness();
    const result = await createPayrollService(harness).lockPayrollPeriod(payrollActor(), "20", "lock-1");
    expect(result.period.status).toBe("locked");
    expect(harness.calls.replace).toBe(1);
    expect(harness.calls.settle).toBe(1);
    expect(harness.calls.audit).toEqual(["payroll.period.lock"]);
  });

  test("requests source row locks only for final lock recalculation", async () => {
    const harness = createPayrollHarness();
    const calls: Array<boolean | undefined> = [];
    const originalLoad = harness.inputs.load;
    harness.inputs.load = async (session, period, options) => {
      calls.push(options?.lockSources);
      return originalLoad(session, period, options);
    };
    await createPayrollService(harness).previewPayrollPeriod(payrollActor(), "20", "preview");
    await createPayrollService(harness).lockPayrollPeriod(payrollActor(), "20", "lock");
    expect(calls).toEqual([undefined, true]);
  });

  test("rejects pending approvals and does not partially settle", async () => {
    const harness = createPayrollHarness({ load: { pendingApprovals: true } });
    await expect(createPayrollService(harness).lockPayrollPeriod(payrollActor(), "20", "lock-pending"))
      .rejects.toMatchObject({ code: "PAYROLL_APPROVALS_PENDING" });
    expect(harness.calls.settle).toBe(0);
  });

  test.each([
    "PAYROLL_CONFIGURATION_MISSING",
    "PAYROLL_ATTENDANCE_INCOMPLETE",
    "PAYROLL_ASSIGNMENT_MISSING",
  ] as const)("rejects %s without settlement", async (code) => {
    const harness = createPayrollHarness({ load: { blockers: [{ code, employeeId: "10", detail: code }] } });
    await expect(createPayrollService(harness).lockPayrollPeriod(payrollActor(), "20", `lock-${code}`))
      .rejects.toMatchObject({ code });
    expect(harness.calls.replace).toBe(0);
    expect(harness.calls.settle).toBe(0);
  });

  test("rejects negative net and an already locked period", async () => {
    const input = calculationFixture();
    input.deductions = [{ id: "1", type: "debt", amount: "99999.00", description: "Debt", date: null }];
    await expect(createPayrollService(createPayrollHarness({ input })).lockPayrollPeriod(payrollActor(), "20", "negative"))
      .rejects.toMatchObject({ code: "PAYROLL_NEGATIVE_NET_PAY" });
    await expect(createPayrollService(createPayrollHarness({ period: periodFixture("locked") })).lockPayrollPeriod(payrollActor(), "20", "again"))
      .rejects.toMatchObject({ code: "PAYROLL_PERIOD_LOCKED" });
  });
});
