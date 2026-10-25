import { describe, expect, test } from "bun:test";
import type { LeaveActor, LeaveDay, LeaveRequest, LeaveType } from "./leave.dto";
import { LeaveError, type LeaveRepository, type LeaveSession } from "./leave.repository";
import { LeaveService, type LeaveAccess } from "./leave.service";

const employee: LeaveActor = { accountId: 1, scope: "self" };
const supervisor: LeaveActor = { accountId: 2, scope: "department" };
const manager: LeaveActor = { accountId: 3, scope: "branch" };
const type: LeaveType = { id: 7, nameTh: "ลากิจ", quotaType: "fixed", isDeductible: false, requiresDocument: false, allowExceed: false, isActive: true };
const request: LeaveRequest = {
  id: 20, employeeId: 11, originalLeaveTypeId: 7, finalLeaveTypeId: null,
  startDate: "2026-09-01", endDate: "2026-09-03", requestedDays: "3",
  reason: null, status: "pending", isRetroactive: false, submittedByUserAccountId: 1,
  submittedAt: new Date(), decidedAt: null, createdAt: new Date(), updatedAt: new Date(),
};
const day = (date: string, id: number): LeaveDay => ({
  id, leaveRequestId: 20, workDayRecordId: null, leaveTypeId: 7,
  leaveDate: date, dayAmount: "1", isPaid: true, isDeductible: false, quotaConsumed: "0",
});
const make = (overrides: Partial<LeaveSession> = {}) => {
  const calls: string[] = [];
  let current = { ...request };
  const session: LeaveSession = {
    transaction: {},
    async lockEmployee() { calls.push("lock"); },
    async findOverlap() { return false; },
    async findType() { return type; },
    async hasAttachment() { return false; },
    async insertRequest(_command, requestedDays) { calls.push("insert"); return { ...request, requestedDays: String(requestedDays) }; },
    async insertDays() { calls.push("days"); },
    async findRequest() { return current; },
    async updatePendingRequest(_id, command, requestedDays) {
      calls.push("update");
      current = {
        ...current, originalLeaveTypeId: command.leaveTypeId, startDate: command.startDate,
        endDate: command.endDate, requestedDays: String(requestedDays), reason: command.reason ?? null,
        isRetroactive: command.isRetroactive ?? false,
      };
      return current;
    },
    async replaceDays() { calls.push("replace-days"); },
    async findDays() { return [day("2026-09-01", 1), day("2026-09-02", 2), day("2026-09-03", 3)]; },
    async findQuota() { return { id: 4, employeeId: 11, leaveTypeId: 7, quotaYear: 2026, entitledDays: "3", usedDays: "0", frozenAt: null }; },
    async updateQuota() { calls.push("quota"); },
    async updateDay() { calls.push("day"); },
    async decide(_id, status, finalTypeId) { calls.push(status); current = { ...current, status, finalLeaveTypeId: finalTypeId }; return current; },
    async appendAction(_id, _actor, action) { calls.push(action); },
    ...overrides,
  };
  const repository: LeaveRepository = {
    async withTransaction(work) { return work(session); },
    async listActiveTypes() { return [type]; },
    async listByEmployee() { return [current]; },
    async findApprovedDays() { return []; },
  };
  const access: LeaveAccess = {
    async assertCanSubmit() {},
    async assertCanDecide() {},
    async assertCanRead() {},
  };
  const service = new LeaveService(repository, access, {
    async applyApprovedLeave(_tx, days) { calls.push(`attendance:${days.length}`); },
  }, { async assertDatesUnlocked() {} });
  return { service, session, access, calls };
};

describe("leave quota before submit/edit", () => {
  const command = { employeeId: 11, leaveTypeId: 7, startDate: "2026-09-01", endDate: "2026-09-03" };
  const quota = { id: 4, employeeId: 11, leaveTypeId: 7, quotaYear: 2026, entitledDays: "3.00", usedDays: "0.00", frozenAt: null };
  for (const operation of ["submit", "edit"] as const) {
    for (const [label, row, code] of [
      ["missing", undefined, "LEAVE_QUOTA_EXCEEDED"],
      ["insufficient fractional balance", { ...quota, entitledDays: "3.29", usedDays: "0.30" }, "LEAVE_QUOTA_EXCEEDED"],
      ["exhausted", { ...quota, usedDays: "3.00" }, "LEAVE_QUOTA_EXCEEDED"],
      ["frozen", { ...quota, frozenAt: new Date() }, "LEAVE_QUOTA_FROZEN"],
    ] as const) {
      test(`${operation} rejects ${label} quota before request/day/action writes`, async () => {
        const fixture = make({ findQuota: async () => row });
        const result = operation === "submit" ? fixture.service.submitLeave(employee, command) : fixture.service.updateLeave(employee, 20, command);
        await expect(result).rejects.toMatchObject({ code });
        expect(fixture.calls).toEqual(["lock"]);
      });
    }
    test(`${operation} validates each year separately without consuming quota`, async () => {
      const years: number[] = [];
      const fixture = make({ findQuota: async (_employeeId, _typeId, year) => {
        years.push(year);
        return { ...quota, quotaYear: year, entitledDays: year === 2026 ? "1" : "0" };
      } });
      const crossYear = { ...command, startDate: "2026-12-31", endDate: "2027-01-01" };
      await expect(operation === "submit" ? fixture.service.submitLeave(employee, crossYear) : fixture.service.updateLeave(employee, 20, crossYear)).rejects.toMatchObject({ code: "LEAVE_QUOTA_EXCEEDED" });
      expect(years).toEqual([2026, 2027]);
      expect(fixture.calls).toEqual(["lock"]);
    });
  }
  test("accepts exact fractional balance without consuming or reserving entitlement", async () => {
    const fixture = make({ findQuota: async () => ({ ...quota, entitledDays: "3.30", usedDays: "0.30" }) });
    await fixture.service.submitLeave(employee, command);
    expect(fixture.calls).toEqual(["lock", "insert", "days", "submitted"]);
  });
  test("no-quota types skip quota rows; explicit allowExceed permits exhausted existing unfrozen quota", async () => {
    const noQuota = make({ findType: async () => ({ ...type, quotaType: "none" }), findQuota: async () => { throw new Error("No quota needed"); } });
    await noQuota.service.submitLeave(employee, command);
    const excess = make({ findType: async () => ({ ...type, allowExceed: true }), findQuota: async () => ({ ...quota, usedDays: "3.00" }) });
    await excess.service.updateLeave(employee, 20, command);
    expect(excess.calls).toEqual(["lock", "update", "replace-days", "overridden"]);
  });
  test("allowExceed still requires an existing unfrozen quota", async () => {
    for (const [row, code] of [[undefined, "LEAVE_QUOTA_EXCEEDED"], [{ ...quota, frozenAt: new Date() }, "LEAVE_QUOTA_FROZEN"]] as const) {
      const fixture = make({ findType: async () => ({ ...type, allowExceed: true }), findQuota: async () => row });
      await expect(fixture.service.submitLeave(employee, command)).rejects.toMatchObject({ code });
      expect(fixture.calls).toEqual(["lock"]);
    }
  });
});

describe("leave decisions", () => {
  test("requires evidence before approval and retains the approval remark", async () => {
    const fixture = make({ findType: async () => ({ ...type, requiresDocument: true }) });
    await expect(fixture.service.approveLeave(manager, 20)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(fixture.calls).not.toContain("quota");
    fixture.session.hasAttachment = async () => true;
    let savedRemark: string | undefined;
    fixture.session.appendAction = async (_id, _actor, action, _from, _to, remark) => { if (action === "approved") savedRemark = remark; };
    await fixture.service.approveLeave(manager, 20, undefined, "ตรวจเอกสารแล้ว");
    expect(savedRemark).toBe("ตรวจเอกสารแล้ว");
  });
  test("lists active leave types for the picker", async () => {
    await expect(make().service.listLeaveTypes(employee)).resolves.toEqual([type]);
  });
  test("submits inclusive dates and blocks pending overlaps", async () => {
    const fixture = make();
    const command = { employeeId: 11, leaveTypeId: 7, startDate: "2026-09-01", endDate: "2026-09-03" };
    expect((await fixture.service.submitLeave(employee, command)).requestedDays).toBe("3");
    expect(fixture.calls).toEqual(["lock", "insert", "days", "submitted"]);
    fixture.session.findOverlap = async () => true;
    await expect(fixture.service.submitLeave(employee, command)).rejects.toMatchObject({ code: "LEAVE_DATE_OVERLAP" });
  });

  test("updates a pending request, replaces its days, and records the correction", async () => {
    const fixture = make();
    const result = await fixture.service.updateLeave(employee, 20, {
      leaveTypeId: 7, startDate: "2026-09-04", endDate: "2026-09-05", reason: "เปลี่ยนวันลา",
    });
    expect(result).toMatchObject({ startDate: "2026-09-04", endDate: "2026-09-05", requestedDays: "2", reason: "เปลี่ยนวันลา" });
    expect(fixture.calls).toEqual(["lock", "update", "replace-days", "overridden"]);
  });

  test("does not update a leave request after it has been decided", async () => {
    const fixture = make({ findRequest: async () => ({ ...request, status: "approved" }) });
    await expect(fixture.service.updateLeave(employee, 20, {
      leaveTypeId: 7, startDate: "2026-09-04", endDate: "2026-09-05",
    })).rejects.toMatchObject({ code: "LEAVE_ALREADY_DECIDED" });
    expect(fixture.calls).toEqual([]);
  });

  test("checks submit scope before updating a pending request", async () => {
    const fixture = make();
    fixture.access.assertCanSubmit = async () => { throw new LeaveError("OUT_OF_SCOPE"); };
    await expect(fixture.service.updateLeave(employee, 20, {
      leaveTypeId: 7, startDate: "2026-09-04", endDate: "2026-09-05",
    })).rejects.toMatchObject({ code: "OUT_OF_SCOPE" });
    expect(fixture.calls).toEqual([]);
  });

  test("three days pass supervisor limit; four days fail before effects", async () => {
    const fixture = make();
    await fixture.service.approveLeave(supervisor, 20);
    expect(fixture.calls).toContain("attendance:3");
    expect(fixture.calls).toContain("quota");
    const four = make({ findRequest: async () => ({ ...request, endDate: "2026-09-04", requestedDays: "4" }) });
    await expect(four.service.approveLeave(supervisor, 20)).rejects.toMatchObject({ code: "SUPERVISOR_APPROVAL_LIMIT" });
    expect(four.calls).toEqual([]);
  });

  test("branch manager can decide a longer request", async () => {
    const fixture = make({
      findRequest: async () => ({ ...request, endDate: "2026-09-04", requestedDays: "4" }),
      findDays: async () => [day("2026-09-01", 1), day("2026-09-02", 2), day("2026-09-03", 3), day("2026-09-04", 4)],
      findQuota: async () => ({ id: 4, employeeId: 11, leaveTypeId: 7, quotaYear: 2026, entitledDays: "4", usedDays: "0", frozenAt: null }),
    });
    expect((await fixture.service.approveLeave(manager, 20)).status).toBe("approved");
  });

  test("enforces quota and frozen quota before attendance", async () => {
    const fixture = make({ findQuota: async () => ({ id: 4, employeeId: 11, leaveTypeId: 7, quotaYear: 2026, entitledDays: "2", usedDays: "0", frozenAt: null }) });
    await expect(fixture.service.approveLeave(manager, 20)).rejects.toMatchObject({ code: "LEAVE_QUOTA_EXCEEDED" });
    expect(fixture.calls).not.toContain("attendance:3");
    const frozen = make({ findQuota: async () => ({ id: 4, employeeId: 11, leaveTypeId: 7, quotaYear: 2026, entitledDays: "3", usedDays: "0", frozenAt: new Date() }) });
    await expect(frozen.service.approveLeave(manager, 20)).rejects.toMatchObject({ code: "LEAVE_QUOTA_FROZEN" });
  });

  test("retains requested type and appends a type-change action", async () => {
    const fixture = make({ findType: async () => ({ ...type, id: 8 }) });
    const result = await fixture.service.approveLeave(manager, 20, 8);
    expect(result.originalLeaveTypeId).toBe(7);
    expect(result.finalLeaveTypeId).toBe(8);
    expect(fixture.calls.slice(-3)).toEqual(["type_changed", "approved", "approved"]);
  });

  test("rejection adds history without quota or attendance writes", async () => {
    const fixture = make();
    expect((await fixture.service.rejectLeave(manager, 20)).status).toBe("rejected");
    expect(fixture.calls).toEqual(["rejected", "rejected"]);
  });

  test("scope denial and decided state make no changes", async () => {
    const fixture = make();
    fixture.access.assertCanDecide = async () => { throw new LeaveError("OUT_OF_SCOPE"); };
    await expect(fixture.service.approveLeave(supervisor, 20)).rejects.toMatchObject({ code: "OUT_OF_SCOPE" });
    expect(fixture.calls).toEqual([]);
    const decided = make({ findRequest: async () => ({ ...request, status: "approved" }) });
    await expect(decided.service.approveLeave(manager, 20)).rejects.toMatchObject({ code: "LEAVE_ALREADY_DECIDED" });
  });
});
