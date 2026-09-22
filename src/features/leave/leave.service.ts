import type { ApprovedLeaveInput, LeaveActor, LeaveRequest, SubmitLeaveCommand } from "./leave.dto";
import { LeaveError, type LeaveRepository, type LeaveSession } from "./leave.repository";

export type LeaveAccess = {
  assertCanSubmit(actor: LeaveActor, employeeId: number, dates: string[]): Promise<void>;
  assertCanDecide(actor: LeaveActor, employeeId: number, dates: string[]): Promise<void>;
  assertCanRead(actor: LeaveActor, employeeId: number): Promise<void>;
};
export type LeaveAttendanceEffect = {
  applyApprovedLeave(transaction: unknown, days: ApprovedLeaveInput[]): Promise<void>;
};
export type LeavePayrollLock = {
  assertDatesUnlocked(transaction: unknown, employeeId: number, dates: string[]): Promise<void>;
};

const datesInclusive = (start: string, end: string): string[] => {
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!pattern.test(start) || !pattern.test(end) || end < start) throw new LeaveError("INVALID_LEAVE");
  const first = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(first.valueOf()) || Number.isNaN(last.valueOf()) ||
      first.toISOString().slice(0, 10) !== start || last.toISOString().slice(0, 10) !== end) {
    throw new LeaveError("INVALID_LEAVE");
  }
  const result: string[] = [];
  for (let time = first.valueOf(); time <= last.valueOf(); time += 86_400_000) {
    result.push(new Date(time).toISOString().slice(0, 10));
    if (result.length > 366) throw new LeaveError("INVALID_LEAVE");
  }
  return result;
};

export class LeaveService {
  constructor(
    private readonly repository: LeaveRepository,
    private readonly access: LeaveAccess,
    private readonly attendance: LeaveAttendanceEffect,
    private readonly payrollLock: LeavePayrollLock,
  ) {}

  async submitLeave(actor: LeaveActor, command: SubmitLeaveCommand): Promise<LeaveRequest> {
    const dates = datesInclusive(command.startDate, command.endDate);
    await this.access.assertCanSubmit(actor, command.employeeId, dates);
    return this.repository.withTransaction(async (session) => {
      await session.lockEmployee(command.employeeId);
      if (await session.findOverlap(command.employeeId, command.startDate, command.endDate)) {
        throw new LeaveError("LEAVE_DATE_OVERLAP");
      }
      const type = await session.findType(command.leaveTypeId);
      if (!type?.isActive) throw new LeaveError("LEAVE_TYPE_UNAVAILABLE");
      const request = await session.insertRequest(command, dates.length, actor.accountId);
      await session.insertDays(request.id, type.id, dates, type.isDeductible);
      await session.appendAction(request.id, actor.accountId, "submitted");
      return request;
    });
  }

  async approveLeave(actor: LeaveActor, id: number, finalTypeId?: number): Promise<LeaveRequest> {
    return this.repository.withTransaction(async (session) => {
      const request = await this.requirePending(session, id);
      const dates = datesInclusive(request.startDate, request.endDate);
      await this.access.assertCanDecide(actor, request.employeeId, dates);
      if (actor.scope === "self") throw new LeaveError("OUT_OF_SCOPE");
      if (actor.scope === "department" && dates.length > 3) {
        throw new LeaveError("SUPERVISOR_APPROVAL_LIMIT");
      }
      await session.lockEmployee(request.employeeId);
      if (await session.findOverlap(request.employeeId, request.startDate, request.endDate, id)) {
        throw new LeaveError("LEAVE_DATE_OVERLAP");
      }
      await this.payrollLock.assertDatesUnlocked(session.transaction, request.employeeId, dates);
      const type = await session.findType(finalTypeId ?? request.originalLeaveTypeId);
      if (!type?.isActive) throw new LeaveError("LEAVE_TYPE_UNAVAILABLE");
      const days = (await session.findDays(id)).sort((a, b) => a.leaveDate.localeCompare(b.leaveDate));
      if (days.length !== dates.length || days.some((day, index) => day.leaveDate !== dates[index])) {
        throw new LeaveError("INVALID_LEAVE");
      }
      const effects: ApprovedLeaveInput[] = [];
      const quotaUse = new Map<number, { id: number; used: number }>();
      for (const day of days) {
        const year = Number(day.leaveDate.slice(0, 4));
        let paid = !type.isDeductible;
        let consumed = "0";
        if (type.quotaType !== "none") {
          let quota = quotaUse.get(year);
          if (!quota) {
            const found = await session.findQuota(request.employeeId, type.id, year);
            if (!found) throw new LeaveError("LEAVE_QUOTA_EXCEEDED");
            if (found.frozenAt) throw new LeaveError("LEAVE_QUOTA_FROZEN");
            quota = { id: found.id, used: Number(found.usedDays) };
            quotaUse.set(year, quota);
          }
          const row = await session.findQuota(request.employeeId, type.id, year);
          if (!row) throw new LeaveError("LEAVE_QUOTA_EXCEEDED");
          if (quota.used + 1 <= Number(row.entitledDays)) {
            quota.used += 1;
            consumed = "1";
          } else if (!type.allowExceed) {
            throw new LeaveError("LEAVE_QUOTA_EXCEEDED");
          } else {
            paid = false;
          }
        }
        const deductible = type.isDeductible || !paid;
        await session.updateDay(day.id, type.id, paid, deductible, consumed);
        effects.push({
          employeeId: request.employeeId, date: day.leaveDate, leaveTypeId: type.id,
          isPaid: paid, isDeductible: deductible, quotaConsumed: consumed,
        });
      }
      for (const quota of quotaUse.values()) await session.updateQuota(quota.id, String(quota.used));
      await this.attendance.applyApprovedLeave(session.transaction, effects);
      if (type.id !== request.originalLeaveTypeId) {
        await session.appendAction(id, actor.accountId, "type_changed", request.originalLeaveTypeId, type.id);
      }
      const decided = await session.decide(id, "approved", type.id);
      await session.appendAction(id, actor.accountId, "approved");
      return decided;
    });
  }

  async rejectLeave(actor: LeaveActor, id: number, remark?: string): Promise<LeaveRequest> {
    return this.repository.withTransaction(async (session) => {
      const request = await this.requirePending(session, id);
      await this.access.assertCanDecide(actor, request.employeeId, datesInclusive(request.startDate, request.endDate));
      if (actor.scope === "self") throw new LeaveError("OUT_OF_SCOPE");
      const decided = await session.decide(id, "rejected", null);
      await session.appendAction(id, actor.accountId, "rejected", undefined, undefined, remark);
      return decided;
    });
  }

  async findApprovedForPayroll(actor: LeaveActor, employeeId: number, startDate: string, endDate: string) {
    datesInclusive(startDate, endDate);
    await this.access.assertCanRead(actor, employeeId);
    return this.repository.findApprovedDays(employeeId, startDate, endDate);
  }

  async listRequests(actor: LeaveActor, employeeId: number) {
    await this.access.assertCanRead(actor, employeeId);
    return this.repository.listByEmployee(employeeId);
  }

  private async requirePending(session: LeaveSession, id: number) {
    const request = await session.findRequest(id);
    if (!request) throw new LeaveError("LEAVE_NOT_FOUND");
    if (request.status !== "pending") throw new LeaveError("LEAVE_ALREADY_DECIDED");
    return request;
  }
}
