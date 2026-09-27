import { describe, expect, test } from "bun:test";
import type { OvertimeActor, OvertimeRecord, SubmitOvertimeCommand } from "./overtime.dto";
import { OvertimeError, type OvertimeRepository, type OvertimeSession } from "./overtime.repository";
import { OvertimeService, assertOvertimeValue } from "./overtime.service";

const actor: OvertimeActor = { accountId: 4, scope: "branch" };
const pending: OvertimeRecord = {
  id: 1, employeeId: 11, overtimeDate: "2026-09-22", overtimeType: "hourly",
  hours: "2", dayUnits: null, workDayRecordId: 8, reason: null, status: "pending",
  requestedByUserAccountId: 11, submittedAt: new Date(), decidedAt: null,
  createdAt: new Date(), updatedAt: new Date(),
};
const hourly: SubmitOvertimeCommand = {
  employeeId: 11, overtimeDate: "2026-09-22", overtimeType: "hourly", hours: "2",
};
const fixture = () => {
  const calls: string[] = [];
  let current = { ...pending };
  const session: OvertimeSession = {
    transaction: {},
    async insert(command) { calls.push("insert"); return { ...pending, ...command, hours: command.hours ?? null, dayUnits: command.dayUnits ?? null }; },
    async findForUpdate() { return current; },
    async decide(_id, status) { calls.push(status); current = { ...current, status }; return current; },
    async appendAction(_id, _actorId, action) { calls.push(action); },
  };
  const repo: OvertimeRepository = {
    async withTransaction(work) { return work(session); },
    async listByEmployee() { return [current]; },
    async findApproved() { return current.status === "approved" ? [current] : []; },
  };
  const access = {
    async assertCanSubmit() {}, async assertCanDecide() {}, async assertCanRead() {},
  };
  const context = { async assertEligible() {} };
  const service = new OvertimeService(repo, access, context, { async assertDateUnlocked() {} });
  return { service, session, access, context, calls };
};

describe("overtime decisions", () => {
  test("validates the three amount shapes", () => {
    expect(() => assertOvertimeValue(hourly)).not.toThrow();
    expect(() => assertOvertimeValue({ ...hourly, overtimeType: "rest_day", hours: null, dayUnits: "1" })).not.toThrow();
    expect(() => assertOvertimeValue({ ...hourly, overtimeType: "public_holiday", hours: null, dayUnits: "0.5" })).not.toThrow();
    for (const invalid of [
      { ...hourly, dayUnits: "1" },
      { ...hourly, hours: "0" },
      { ...hourly, overtimeType: "rest_day" as const, hours: null, dayUnits: "1.01" },
    ]) expect(() => assertOvertimeValue(invalid)).toThrow(OvertimeError);
  });
  test("requires qualifying context before persistence", async () => {
    const f = fixture();
    f.context.assertEligible = async () => { throw new OvertimeError("OVERTIME_CONTEXT_INVALID"); };
    await expect(f.service.submitOvertime(actor, hourly)).rejects.toMatchObject({ code: "OVERTIME_CONTEXT_INVALID" });
    expect(f.calls).toEqual([]);
  });
  test("submits pending and only explicit approval becomes payable", async () => {
    const f = fixture();
    expect((await f.service.submitOvertime(actor, hourly)).status).toBe("pending");
    expect(await f.service.findApprovedForPayroll(actor, 11, "2026-09-01", "2026-09-30")).toEqual([]);
    expect((await f.service.approveOvertime(actor, 1)).status).toBe("approved");
    expect(await f.service.findApprovedForPayroll(actor, 11, "2026-09-01", "2026-09-30")).toHaveLength(1);
    expect(f.calls).toEqual(["insert", "submitted", "approved", "approved"]);
  });
  test("rejection is not payable and second decision is blocked", async () => {
    const f = fixture();
    await f.service.rejectOvertime(actor, 1);
    await expect(f.service.approveOvertime(actor, 1)).rejects.toMatchObject({ code: "OVERTIME_NOT_PENDING" });
    expect(await f.service.findApprovedForPayroll(actor, 11, "2026-09-01", "2026-09-30")).toEqual([]);
  });
  test("scope denial stops decisions", async () => {
    const f = fixture();
    f.access.assertCanDecide = async () => { throw new OvertimeError("OUT_OF_SCOPE"); };
    await expect(f.service.approveOvertime(actor, 1)).rejects.toMatchObject({ code: "OUT_OF_SCOPE" });
    expect(f.calls).toEqual([]);
  });
});
