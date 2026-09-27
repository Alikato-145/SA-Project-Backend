import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { AttendanceRepository } from "./attendance.repository";
import { AttendanceError } from "./attendance.repository";
import { AttendanceService, type AttendanceAccess, type PayrollLockGuard } from "./attendance.service";
import type { WorkDayRecord } from "./attendance.dto";
import { workDayRecords } from "./attendance.schema";

const record: WorkDayRecord = {
  id: 1, employeeId: 20, branchId: 10, workDate: "2026-09-22", status: "present",
  clockInAt: new Date("2026-09-22T09:00:00Z"), clockOutAt: new Date("2026-09-22T18:00:00Z"),
  lateMinutes: 0, isDeductible: false, note: null, entrySource: "manual", createdByUserAccountId: 7,
  createdAt: new Date(), updatedAt: new Date(),
};

const makeRepository = (): AttendanceRepository & { insertCalls: number; lastCorrection?: object } => ({
  insertCalls: 0,
  async insert(command) { this.insertCalls += 1; return { ...record, ...command }; },
  async findById() { return record; },
  async updateCorrectable(_id, command) { this.lastCorrection = command; return { ...record, ...command }; },
  async findForPayrollRange() { return [record]; },
});

const access = (): AttendanceAccess => ({
  async assertCanManageWorkDay() {},
  async assertEmployeeAssignedToBranch() {},
  async assertCanReadWorkDays() {},
});
const unlocked = (): PayrollLockGuard => ({ async assertWorkDayCanBeCorrected() {} });

describe("AttendanceService", () => {
  test("checks scope and effective assignment before writing a manual record", async () => {
    const store = makeRepository();
    const denied = access();
    denied.assertCanManageWorkDay = async () => { throw new AttendanceError("OUT_OF_SCOPE"); };
    const service = new AttendanceService(store, denied, unlocked());
    await expect(service.createManualWorkDay({ accountId: 7 }, { ...record })).rejects.toMatchObject({ code: "OUT_OF_SCOPE" });
    expect(store.insertCalls).toBe(0);
  });

  test("writes manual source and preserves the submitted historical branch", async () => {
    const store = makeRepository();
    const service = new AttendanceService(store, access(), unlocked());
    const created = await service.createManualWorkDay({ accountId: 7 }, { ...record });
    expect(created).toMatchObject({ branchId: 10, entrySource: "manual", createdByUserAccountId: 7 });
  });

  test("preserves duplicate and clock-order conflicts", async () => {
    const store = makeRepository();
    store.insert = async () => { throw new AttendanceError("WORK_DAY_ALREADY_EXISTS"); };
    const service = new AttendanceService(store, access(), unlocked());
    await expect(service.createManualWorkDay({ accountId: 7 }, { ...record })).rejects.toMatchObject({ code: "WORK_DAY_ALREADY_EXISTS" });
    await expect(service.createManualWorkDay({ accountId: 7 }, { ...record, clockOutAt: new Date("2026-09-22T08:00:00Z") }))
      .rejects.toMatchObject({ code: "INVALID_CLOCK_RANGE" });
  });

  test("corrects only permitted fields without mutating branch or source", async () => {
    const store = makeRepository();
    const service = new AttendanceService(store, access(), unlocked());
    const corrected = await service.correctWorkDay({ accountId: 7 }, 1, { status: "late", lateMinutes: 5 });
    expect(corrected).toMatchObject({ branchId: 10, entrySource: "manual", status: "late", lateMinutes: 5 });
    expect(store.lastCorrection).not.toHaveProperty("branchId");
    expect(store.lastCorrection).not.toHaveProperty("entrySource");
  });

  test("rejects correction after the payroll lock guard denies it", async () => {
    const locked: PayrollLockGuard = { async assertWorkDayCanBeCorrected() { throw new AttendanceError("PAYROLL_PERIOD_LOCKED"); } };
    const service = new AttendanceService(makeRepository(), access(), locked);
    await expect(service.correctWorkDay({ accountId: 7 }, 1, { status: "absent" }))
      .rejects.toMatchObject({ code: "PAYROLL_PERIOD_LOCKED" });
  });

  test("reserves leave status for transactional approval", async () => {
    const store = makeRepository();
    const service = new AttendanceService(store, access(), unlocked());
    await expect(service.createManualWorkDay({ accountId: 7 }, { ...record, status: "leave" }))
      .rejects.toMatchObject({ code: "ATTENDANCE_LEAVE_REQUIRES_APPROVAL" });
    await expect(service.correctWorkDay({ accountId: 7 }, 1, { status: "leave" }))
      .rejects.toMatchObject({ code: "ATTENDANCE_LEAVE_REQUIRES_APPROVAL" });
    store.findById = async () => ({ ...record, status: "leave" });
    await expect(service.correctWorkDay({ accountId: 7 }, 1, { status: "absent" }))
      .rejects.toMatchObject({ code: "ATTENDANCE_LEAVE_REQUIRES_APPROVAL" });
    expect(store.insertCalls).toBe(0);
  });

  test("reads bounded date ranges for payroll inputs", async () => {
    const service = new AttendanceService(makeRepository(), access(), unlocked());
    await expect(service.findForPayrollRange({ accountId: 7 }, {
      employeeId: 20, startDate: "2026-09-01", endDate: "2026-09-30",
    })).resolves.toEqual([record]);
  });

  test("counts only present and late work days for an advance month", async () => {
    const store = makeRepository();
    store.findForPayrollRange = async () => ["present", "late", "absent", "leave",
      "weekly_holiday", "public_holiday"].map((status, index) => ({
        ...record, id: index + 1, status: status as WorkDayRecord["status"],
      }));
    const service = new AttendanceService(store, access(), unlocked());
    expect(await service.countWorkedDaysForAdvance({ accountId: 7 }, 20,
      "2026-09-01", "2026-09-22")).toBe(2);
  });
});

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const fixtureEmployeeId = Number(process.env.B1_TEST_EMPLOYEE_ID);
const fixtureBranchId = Number(process.env.B1_TEST_BRANCH_ID);
const databaseTest = testDatabaseUrl && Number.isSafeInteger(fixtureEmployeeId) && Number.isSafeInteger(fixtureBranchId)
  ? test
  : test.skip;

databaseTest("database enforces uniqueness, clock order, and stores the branch snapshot", async () => {
  const pool = new Pool({ connectionString: testDatabaseUrl });
  const testDb = drizzle({ client: pool });
  const workDate = "2099-12-30";
  const values = {
    employeeId: fixtureEmployeeId,
    branchId: fixtureBranchId,
    workDate,
    status: "present" as const,
    lateMinutes: 0,
    isDeductible: false,
    entrySource: "manual" as const,
  };
  try {
    await testDb.transaction(async (transaction) => {
      const [stored] = await transaction.insert(workDayRecords).values(values).returning();
      expect(stored.branchId).toBe(fixtureBranchId);

      await expect(transaction.transaction(async (savepoint) => {
        await savepoint.insert(workDayRecords).values(values);
      })).rejects.toBeDefined();
      await expect(transaction.transaction(async (savepoint) => {
        await savepoint.insert(workDayRecords).values({
          ...values,
          workDate: "2099-12-29",
          clockInAt: new Date("2099-12-29T09:00:00Z"),
          clockOutAt: new Date("2099-12-29T08:00:00Z"),
        });
      })).rejects.toBeDefined();
      throw new Error("ROLLBACK_B1_ATTENDANCE_TEST");
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "ROLLBACK_B1_ATTENDANCE_TEST") throw error;
  } finally {
    await pool.end();
  }
});
