import { describe, expect, test } from "bun:test";
import { createPayrollService } from "./payroll.service";
import { createPayrollHarness, payrollActor } from "./payroll.test-support";

const command = { actor: payrollActor(), requestId: "adjust", originalRecordId: "70", targetPeriodId: "20",
  direction: "earning" as const, amount: "100.00", reason: "Correction" };

describe("payroll adjustments", () => {
  test("requests and decides a traceable adjustment without changing original", async () => {
    const harness = createPayrollHarness();
    const service = createPayrollService(harness);
    expect((await service.requestPayrollAdjustment(command)).status).toBe("pending");
    expect((await service.decidePayrollAdjustment(payrollActor(), "60", "approved", "approve")).status).toBe("approved");
    expect(harness.calls.audit).toEqual(["payroll.adjustment.request", "payroll.adjustment.approved"]);
  });

  test("requires locked original, unlocked target, positive amount, and reason", async () => {
    await expect(createPayrollService(createPayrollHarness({ originalStatus: "calculated" })).requestPayrollAdjustment(command))
      .rejects.toMatchObject({ code: "PAYROLL_ADJUSTMENT_INVALID" });
    await expect(createPayrollService(createPayrollHarness()).requestPayrollAdjustment({ ...command, amount: "0.00" }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(createPayrollService(createPayrollHarness()).requestPayrollAdjustment({ ...command, reason: " " }))
      .rejects.toMatchObject({ code: "PAYROLL_ADJUSTMENT_INVALID" });
  });

  test("requires the target period to be later than the locked original", async () => {
    const service = createPayrollService(createPayrollHarness({ originalPeriodEnd: "2026-09-30" }));
    await expect(service.requestPayrollAdjustment(command))
      .rejects.toMatchObject({ code: "PAYROLL_ADJUSTMENT_STATE_CONFLICT" });
  });
});
