import type {
  AttendanceActor,
  CorrectWorkDayCommand,
  CreateManualWorkDayCommand,
  WorkDayRangeFilter,
  WorkDayRecord,
} from "./attendance.dto";
import { AttendanceError, type AttendanceRepository } from "./attendance.repository";

export type AttendanceAccess = {
  assertCanManageWorkDay(actor: AttendanceActor, command: Pick<CreateManualWorkDayCommand, "employeeId" | "branchId" | "workDate">): Promise<void>;
  assertEmployeeAssignedToBranch(employeeId: number, branchId: number, workDate: string): Promise<void>;
  assertCanReadWorkDays(actor: AttendanceActor, filter: WorkDayRangeFilter): Promise<void>;
};

export type PayrollLockGuard = {
  assertWorkDayCanBeCorrected(record: WorkDayRecord): Promise<void>;
};

export class AttendanceService {
  constructor(
    private readonly repository: AttendanceRepository,
    private readonly access: AttendanceAccess,
    private readonly payrollLockGuard: PayrollLockGuard,
  ) {}

  async createManualWorkDay(actor: AttendanceActor, command: CreateManualWorkDayCommand): Promise<WorkDayRecord> {
    if (command.status === "leave") throw new AttendanceError("ATTENDANCE_LEAVE_REQUIRES_APPROVAL");
    await this.access.assertCanManageWorkDay(actor, command);
    await this.access.assertEmployeeAssignedToBranch(command.employeeId, command.branchId, command.workDate);
    this.assertRecord(command);
    return this.repository.insert({ ...command, entrySource: "manual", createdByUserAccountId: actor.accountId });
  }

  async correctWorkDay(actor: AttendanceActor, id: number, command: CorrectWorkDayCommand): Promise<WorkDayRecord> {
    const record = await this.requireRecord(id);
    if (record.status === "leave" || command.status === "leave") {
      throw new AttendanceError("ATTENDANCE_LEAVE_REQUIRES_APPROVAL");
    }
    await this.access.assertCanManageWorkDay(actor, record);
    await this.payrollLockGuard.assertWorkDayCanBeCorrected(record);
    this.assertRecord({ ...record, ...command });
    return (await this.repository.updateCorrectable(id, command)) ?? this.notFound();
  }

  async findForPayrollRange(actor: AttendanceActor, filter: WorkDayRangeFilter): Promise<WorkDayRecord[]> {
    this.assertRange(filter);
    await this.access.assertCanReadWorkDays(actor, filter);
    return this.repository.findForPayrollRange(filter);
  }

  async countWorkedDaysForAdvance(actor: AttendanceActor, employeeId: number,
    monthStart: string, requestDate: string): Promise<number> {
    if (!/^\d{4}-\d{2}-01$/.test(monthStart) || requestDate.slice(0, 7) !== monthStart.slice(0, 7)) {
      throw new AttendanceError("INVALID_ATTENDANCE");
    }
    const rows = await this.findForPayrollRange(actor, {
      employeeId, startDate: monthStart, endDate: requestDate,
    });
    return rows.filter((row) => row.status === "present" || row.status === "late").length;
  }

  private assertRecord(record: Pick<CreateManualWorkDayCommand, "workDate" | "clockInAt" | "clockOutAt" | "lateMinutes">) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(record.workDate) || record.lateMinutes < 0) {
      throw new AttendanceError("INVALID_ATTENDANCE");
    }
    if (record.clockInAt && record.clockOutAt && record.clockOutAt < record.clockInAt) {
      throw new AttendanceError("INVALID_CLOCK_RANGE");
    }
  }

  private assertRange(filter: WorkDayRangeFilter) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(filter.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(filter.endDate) || filter.endDate < filter.startDate) {
      throw new AttendanceError("INVALID_ATTENDANCE");
    }
  }

  private async requireRecord(id: number) {
    return (await this.repository.findById(id)) ?? this.notFound();
  }

  private notFound(): never {
    throw new AttendanceError("ATTENDANCE_NOT_FOUND");
  }
}
