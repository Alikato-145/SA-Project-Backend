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


describe("current-period adjustments", () => {
  const current = { actor: payrollActor(), requestId: "current", employeeId: "3", targetPeriodId: "20", direction: "earning" as const, amount: "100.00", reason: "Bonus" };
  test("requests without a locked original", async () => {
    const result = await createPayrollService(createPayrollHarness()).requestPayrollAdjustment(current);
    expect(result.employeeId).toBe("3");
    expect(result.originalPayrollRecordId).toBeNull();
  });
  test("rejects mismatched original employee", async () => {
    await expect(createPayrollService(createPayrollHarness()).requestPayrollAdjustment({ ...command, employeeId: "999" }))
      .rejects.toMatchObject({ code: "PAYROLL_ADJUSTMENT_INVALID" });
  });
  test("requires employee and matching shop assignment", async () => {
    await expect(createPayrollService(createPayrollHarness()).requestPayrollAdjustment({ ...current, employeeId: undefined }))
      .rejects.toMatchObject({ code: "PAYROLL_ADJUSTMENT_INVALID" });
    await expect(createPayrollService(createPayrollHarness({ hasAssignment: false })).requestPayrollAdjustment(current))
      .rejects.toMatchObject({ code: "PAYROLL_ASSIGNMENT_MISSING" });
  });
  for (const roleCode of ["EMPLOYEE", "SUPERVISOR", "BRANCH_MANAGER"] as const) {
    test(`rejects ${roleCode} request and approval`, async () => {
      const actor = { ...payrollActor(), grants: [{ grantId: "1", roleCode, scope: "all" as const, branchId: null, departmentId: null }] };
      const service = createPayrollService(createPayrollHarness());
      await expect(service.requestPayrollAdjustment({ ...current, actor })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
      await expect(service.decidePayrollAdjustment(actor, "60", "approved", "denied")).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
    });
  }
  test("approves current item without looking up a historical record", async () => {
    const harness = createPayrollHarness();
    const service = createPayrollService(harness);
    await service.requestPayrollAdjustment(current);
    expect((await service.decidePayrollAdjustment(payrollActor(), "60", "approved", "approve-current")).status).toBe("approved");
  });
});
