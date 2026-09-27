import type { OvertimeActor, OvertimeRecord, SubmitOvertimeCommand } from "./overtime.dto";
import { OvertimeError, type OvertimeRepository, type OvertimeSession } from "./overtime.repository";

export type OvertimeAccess = {
  assertCanSubmit(actor: OvertimeActor, employeeId: number, date: string): Promise<void>;
  assertCanDecide(actor: OvertimeActor, employeeId: number, date: string): Promise<void>;
  assertCanRead(actor: OvertimeActor, employeeId: number): Promise<void>;
};
export type OvertimeContext = {
  assertEligible(command: SubmitOvertimeCommand): Promise<void>;
};
export type OvertimePayrollLock = {
  assertDateUnlocked(transaction: unknown, employeeId: number, date: string): Promise<void>;
};
const validDate = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.valueOf()) ||
      date.toISOString().slice(0, 10) !== value) throw new OvertimeError("INVALID_OVERTIME_DATE");
};
const amount = (value: string | null | undefined) =>
  typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value) && Number(value) > 0;
export const assertOvertimeValue = (command: SubmitOvertimeCommand) => {
  if (command.overtimeType === "hourly") {
    if (!amount(command.hours) || command.dayUnits != null) throw new OvertimeError("INVALID_OVERTIME_AMOUNT");
  } else if (command.overtimeType === "rest_day" || command.overtimeType === "public_holiday") {
    if (!amount(command.dayUnits) || Number(command.dayUnits) > 1 || command.hours != null) {
      throw new OvertimeError("INVALID_OVERTIME_AMOUNT");
    }
  } else {
    throw new OvertimeError("INVALID_OVERTIME_AMOUNT");
  }
};
export class OvertimeService {
  constructor(
    private readonly repository: OvertimeRepository,
    private readonly access: OvertimeAccess,
    private readonly context: OvertimeContext,
    private readonly payrollLock: OvertimePayrollLock,
  ) {}
  async submitOvertime(actor: OvertimeActor, command: SubmitOvertimeCommand): Promise<OvertimeRecord> {
    validDate(command.overtimeDate);
    assertOvertimeValue(command);
    await this.access.assertCanSubmit(actor, command.employeeId, command.overtimeDate);
    await this.context.assertEligible(command);
    return this.repository.withTransaction(async (session) => {
      await this.payrollLock.assertDateUnlocked(session.transaction, command.employeeId, command.overtimeDate);
      const record = await session.insert(command, actor.accountId);
      await session.appendAction(record.id, actor.accountId, "submitted");
      return record;
    });
  }
  async approveOvertime(actor: OvertimeActor, id: number, remark?: string) {
    return this.decide(actor, id, "approved", remark);
  }
  async rejectOvertime(actor: OvertimeActor, id: number, remark?: string) {
    return this.decide(actor, id, "rejected", remark);
  }
  async findApprovedForPayroll(actor: OvertimeActor, employeeId: number, startDate: string, endDate: string) {
    validDate(startDate);
    validDate(endDate);
    if (endDate < startDate) throw new OvertimeError("INVALID_OVERTIME_DATE");
    await this.access.assertCanRead(actor, employeeId);
    return this.repository.findApproved(employeeId, startDate, endDate);
  }
  async listRequests(actor: OvertimeActor, employeeId: number) {
    await this.access.assertCanRead(actor, employeeId);
    return this.repository.listByEmployee(employeeId);
  }
  private async decide(actor: OvertimeActor, id: number, decision: "approved" | "rejected", remark?: string) {
    return this.repository.withTransaction(async (session: OvertimeSession) => {
      const record = await session.findForUpdate(id);
      if (!record) throw new OvertimeError("OVERTIME_NOT_FOUND");
      await this.access.assertCanDecide(actor, record.employeeId, record.overtimeDate);
      if (actor.scope === "self") throw new OvertimeError("OUT_OF_SCOPE");
      if (record.status !== "pending") throw new OvertimeError("OVERTIME_NOT_PENDING");
      await this.payrollLock.assertDateUnlocked(session.transaction, record.employeeId, record.overtimeDate);
      const decided = await session.decide(id, decision);
      await session.appendAction(id, actor.accountId, decision, remark);
      return decided;
    });
  }
}
