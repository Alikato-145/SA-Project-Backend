import { describe, expect, test } from "bun:test";
import type { WorkDayRecord } from "./attendance.dto";
import { AttendanceLeaveEffect, type AssignmentBranch } from "./attendance-leave-effect.service";
import type { AttendanceLeaveEffectRepository } from "./attendance-leave-effect.repository";

const day = { employeeId: 20, date: "2026-09-22", leaveTypeId: 4,
  isPaid: true, isDeductible: false, quotaConsumed: "1" };
const present: WorkDayRecord = { id: 1, employeeId: 20, branchId: 10,
  workDate: "2026-09-22", status: "present", clockInAt: null,
  clockOutAt: null, lateMinutes: 0, isDeductible: false, note: null,
  entrySource: "manual", createdByUserAccountId: 7, createdAt: new Date(), updatedAt: new Date() };
const fixture = (existing?: WorkDayRecord) => {
  const writes: object[] = [];
  let assignmentCalls = 0;
  const repository: AttendanceLeaveEffectRepository = {
    async findForUpdate() { return existing; },
    async markLeave(_transaction, id, deductible) { writes.push({ id, deductible }); },
    async insertLeave(_transaction, employeeId, branchId, date, deductible) {
      writes.push({ employeeId, branchId, date, deductible });
    },
  };
  const assignment: AssignmentBranch = { async branchAtDate() { assignmentCalls++; return 12; } };
  return { effect: new AttendanceLeaveEffect(repository, assignment), writes,
    get assignmentCalls() { return assignmentCalls; } };
};
describe("approved leave attendance effect", () => {
  test("updates absence in the same transaction and keeps its branch", async () => {
    const f = fixture({ ...present, status: "absent", branchId: 10 });
    const transaction = {};
    await f.effect.applyApprovedLeave(transaction, [day]);
    expect(f.writes).toEqual([{ id: 1, deductible: false }]);
    expect(f.assignmentCalls).toBe(0);
  });
  test("inserts missing day with the effective historical branch", async () => {
    const f = fixture();
    await f.effect.applyApprovedLeave({}, [day]);
    expect(f.writes).toEqual([{ employeeId: 20, branchId: 12,
      date: "2026-09-22", deductible: false }]);
  });
  test("refuses to rewrite worked or holiday records", async () => {
    for (const status of ["present", "late", "weekly_holiday", "public_holiday"] as const) {
      const f = fixture({ ...present, status });
      await expect(f.effect.applyApprovedLeave({}, [day]))
        .rejects.toMatchObject({ code: "ATTENDANCE_LEAVE_CONFLICT" });
      expect(f.writes).toEqual([]);
    }
  });
  test("fails when no effective assignment exists", async () => {
    const f = fixture();
    const missing = new AttendanceLeaveEffect({
      async findForUpdate() { return undefined; },
      async markLeave() {}, async insertLeave() {},
    }, { async branchAtDate() { return undefined; } });
    await expect(missing.applyApprovedLeave({}, [day]))
      .rejects.toMatchObject({ code: "ATTENDANCE_ASSIGNMENT_NOT_FOUND" });
    expect(f.writes).toEqual([]);
  });
});
