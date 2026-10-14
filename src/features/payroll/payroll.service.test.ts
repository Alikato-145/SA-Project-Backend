import { describe, expect, test } from "bun:test";
import { createPayrollService } from "./payroll.service";
import { createPayrollHarness, payrollActor, calculationFixture } from "./payroll.test-support";

const configCommand = { actor: payrollActor(), requestId: "req-config", shopId: "1", branchId: null,
  configKey: "STANDARD_WORK_DAYS" as const, numericValue: "20.0000", unit: "days", effectiveFrom: "2026-01-01", effectiveTo: null };
const periodCommand = { actor: payrollActor(), requestId: "req-period", shopId: "1", periodYear: 2026,
  periodMonth: 9, startDate: "2026-09-01", endDate: "2026-09-30" };

describe("payroll configuration and period service", () => {
  test("creates configuration and period with audit evidence", async () => {
    const harness = createPayrollHarness();
    const service = createPayrollService(harness);
    expect((await service.createPayrollConfiguration(configCommand)).id).toBe("5");
    expect((await service.createPayrollPeriod(periodCommand)).id).toBe("20");
    expect(harness.calls.audit).toEqual(["payroll.configuration.create", "payroll.period.create"]);
  });

  test("rejects overlapping configuration and duplicate period", async () => {
    await expect(createPayrollService(createPayrollHarness({ overlap: true })).createPayrollConfiguration(configCommand))
      .rejects.toMatchObject({ code: "PAYROLL_CONFIGURATION_OVERLAP" });
    await expect(createPayrollService(createPayrollHarness({ duplicatePeriod: true })).createPayrollPeriod(periodCommand))
      .rejects.toMatchObject({ code: "PAYROLL_PERIOD_DUPLICATE" });
  });

  test("rejects a missing shop before a foreign-key insert", async () => {
    const service = createPayrollService(createPayrollHarness({ shopExists: false }));
    await expect(service.createPayrollConfiguration(configCommand)).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    await expect(service.createPayrollPeriod(periodCommand)).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });

  test("rejects unsupported key/unit combinations and negative values", async () => {
    const service = createPayrollService(createPayrollHarness());
    await expect(service.createPayrollConfiguration({ ...configCommand, unit: "currency" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(service.createPayrollConfiguration({ ...configCommand, numericValue: "-1.0000" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  test("denies branch manager mutations and filters configuration reads", async () => {
    const harness = createPayrollHarness();
    const service = createPayrollService(harness);
    const manager = payrollActor("BRANCH_MANAGER", "2");
    await expect(service.createPayrollPeriod({ ...periodCommand, actor: manager })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
    expect(await service.listPayrollConfigurations(manager, "1")).toHaveLength(1);
  });

  test("applies bounded pagination after scope and business filters", async () => {
    const service = createPayrollService(createPayrollHarness());
    expect(await service.listPayrollConfigurations(payrollActor(), "1", { page: 1, pageSize: 1 })).toHaveLength(1);
    expect(await service.listPayrollConfigurations(payrollActor(), "1", { page: 2, pageSize: 1 })).toEqual([]);
    expect(await service.listPayrollPeriods(payrollActor(), "1", { year: 2026, page: 2, pageSize: 1 })).toEqual([]);
  });

  test("records audit evidence before disclosing a scoped payroll record", async () => {
    const harness = createPayrollHarness();
    await createPayrollService(harness).getPayrollRecord(payrollActor(), "20", "70", "read-record");
    expect(harness.calls.audit).toEqual(["payroll.record.read"]);
  });
});


test("configuration successor preserves prior value and ends its coverage before the new date",async()=>{
  const harness=createPayrollHarness();
  await createPayrollService(harness).supersedePayrollConfiguration({actor:payrollActor(),requestId:"successor",configurationId:"5",numericValue:"26",effectiveFrom:"2026-10-01",effectiveTo:null});
  expect(harness.calls.endedConfigurations).toEqual([{id:"5",date:"2026-09-30"}]);
  expect(harness.calls.audit).toContain("payroll.configuration.supersede");
});
test("configuration changes reject locked coverage, same-day overwrite and foreign-shop branches",async()=>{
  const successor={actor:payrollActor(),requestId:"successor",configurationId:"5",numericValue:"26",effectiveFrom:"2026-10-01",effectiveTo:null};
  const locked=createPayrollService(createPayrollHarness({configurationLocked:true}));
  await expect(locked.createPayrollConfiguration(configCommand)).rejects.toMatchObject({code:"PAYROLL_PERIOD_LOCKED"});
  await expect(locked.supersedePayrollConfiguration(successor)).rejects.toMatchObject({code:"PAYROLL_PERIOD_LOCKED"});
  await expect(createPayrollService(createPayrollHarness()).supersedePayrollConfiguration({...successor,effectiveFrom:"2026-01-01"})).rejects.toMatchObject({code:"VALIDATION_ERROR"});
  await expect(createPayrollService(createPayrollHarness({branchInShop:false})).createPayrollConfiguration({...configCommand,branchId:"9"})).rejects.toMatchObject({code:"RESOURCE_NOT_FOUND"});
});
test("configuration succession rejects archived shops and branches before ending history",async()=>{
  const successor={actor:payrollActor(),requestId:"successor",configurationId:"5",numericValue:"26",effectiveFrom:"2026-10-01",effectiveTo:null};
  for(const options of [{shopExists:false},{branchInShop:false}]) {
    const harness=createPayrollHarness({...options,configurationBranchId:"2"});
    await expect(createPayrollService(harness).supersedePayrollConfiguration(successor)).rejects.toMatchObject({code:"RESOURCE_NOT_FOUND"});
    expect(harness.calls.endedConfigurations).toEqual([]);
  }
});

test("large but valid input rates produce a blocker rather than numeric database overflow",async()=>{
  const input=calculationFixture();input.baseSalary="9999999999.99";input.standardWorkDays="0.01";
  const harness=createPayrollHarness({input});const service=createPayrollService(harness);
  const preview=await service.previewPayrollPeriod(payrollActor(),"20","overflow-preview");
  expect(preview.blockers.some(row=>row.code==="PAYROLL_CALCULATION_OUT_OF_RANGE")).toBe(true);expect(harness.calls.replace).toBe(0);
  await expect(service.lockPayrollPeriod(payrollActor(),"20","overflow-lock")).rejects.toMatchObject({code:"PAYROLL_CALCULATION_OUT_OF_RANGE"});
  expect(harness.calls.replace).toBe(0);expect(harness.calls.settle).toBe(0);
});
