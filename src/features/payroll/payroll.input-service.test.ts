import { describe, expect, test } from "bun:test";
import type { DatabaseExecutor } from "../../core/db/transaction";
import { createPayrollInputService } from "./payroll.service";
import { calculationFixture, periodFixture } from "./payroll.test-support";
import type { PayrollInputLoadResult, PayrollRepositorySession } from "./payroll.repository";

const fixture = () => {
  const calls: string[] = [];
  const executor = { execute: async () => { calls.push("serialize"); } } as unknown as DatabaseExecutor;
  let locked = false;
  let period = periodFixture();
  let loaded: PayrollInputLoadResult = { inputs: [calculationFixture()], blockers: [], pendingApprovals: true };
  const repository = {
    async findDebtSettlement() { return undefined; },
    session: (value: DatabaseExecutor) => ({ executor: value }) as PayrollRepositorySession,
    async findLockedInputPeriod() { calls.push("inspect"); return locked; },
    async findProjectionPeriod() { return period; },
  };
  const service = createPayrollInputService(repository, { async load(session, _period, options) {
    expect(session.executor).toBe(executor);
    expect(options?.projectionCutoff).toBe("2026-09-20");
    return loaded;
  } });
  return { service, executor, calls, setLocked: () => { locked = true; },
    setPeriod: (value: typeof period) => { period = value; }, setLoad: (value: typeof loaded) => { loaded = value; } };
};

describe("transaction-scoped payroll input service", () => {
  test("serializes before checking locked source dates", async () => {
    const f = fixture();
    await f.service.assertInputsMutable(f.executor, { employeeId: 10, startDate: "2026-09-01", endDate: "2026-09-03" });
    expect(f.calls).toEqual(["serialize", "inspect"]);
    f.setLocked();
    await expect(f.service.assertInputsMutable(f.executor, { branchId: 2, startDate: "2026-09-01", endDate: "2026-09-30" }))
      .rejects.toMatchObject({ code: "PAYROLL_PERIOD_LOCKED" });
  });

  test("rejects unbounded or invalid mutations before persistence", async () => {
    const f = fixture();
    await expect(f.service.assertInputsMutable(f.executor, { startDate: "2026-09-01", endDate: "2026-09-30" }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(f.service.assertInputsMutable(f.executor, { shopId: 1, startDate: "2026-09-30", endDate: "2026-09-01" }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(f.calls).toEqual([]);
  });

  test("projects candidate advance once using the same exact payroll deductions", async () => {
    const f = fixture();
    const input = calculationFixture();
    input.deductions = [
      { id: "loan", type: "loan_installment", amount: "100.00", description: "Installment", date: "2026-09-01" },
      { id: "food", type: "debt", amount: "50.01", description: "Food", date: "2026-09-01" },
    ];
    f.setLoad({ inputs: [input], blockers: [], pendingApprovals: true });
    expect(await f.service.projectAdvance(f.executor, { employeeId: 10, date: "2026-09-20", amount: "849.99" })).toBe("0.00");
    expect(await f.service.projectAdvance(f.executor, { employeeId: 10, date: "2026-09-20", amount: "850.00" })).toBe("-0.01");
  });

  test("fails safe if the employee's projection is incomplete or already locked", async () => {
    const f = fixture();
    f.setLoad({ inputs: [], blockers: [{ employeeId: "10", code: "PAYROLL_ATTENDANCE_INCOMPLETE", detail: "Missing attendance" }], pendingApprovals: false });
    await expect(f.service.projectAdvance(f.executor, { employeeId: 10, date: "2026-09-20", amount: "100.00" }))
      .rejects.toMatchObject({ code: "PAYROLL_ATTENDANCE_INCOMPLETE" });
    f.setPeriod(periodFixture("locked"));
    await expect(f.service.projectAdvance(f.executor, { employeeId: 10, date: "2026-09-20", amount: "100.00" }))
      .rejects.toMatchObject({ code: "PAYROLL_PERIOD_LOCKED" });
  });
});

const databaseTest = process.env.TEST_DATABASE_URL ? test : test.skip;
databaseTest("input serialization spans connections and releases on rollback", async () => {
  const { Client } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { serializePayrollInputs } = await import("./payroll.input-lock.repository");
  const first = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  const second = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  try {
    await first.connect();
    await second.connect();
    await first.query("begin");
    await second.query("begin");
    await serializePayrollInputs(drizzle(first));
    expect((await second.query("select pg_try_advisory_xact_lock(72419, 5) as acquired")).rows[0].acquired).toBe(false);
    await first.query("rollback");
    expect((await second.query("select pg_try_advisory_xact_lock(72419, 5) as acquired")).rows[0].acquired).toBe(true);
  } finally {
    await first.query("rollback").catch(() => {});
    await second.query("rollback").catch(() => {});
    await first.end();
    await second.end();
  }
});
