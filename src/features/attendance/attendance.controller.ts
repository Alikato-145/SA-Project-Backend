import type {
  AttendanceActor,
  CorrectWorkDayCommand,
  CreateManualWorkDayCommand,
  WorkDayRangeFilter,
} from "./attendance.dto";
import { toWorkDayRecordResponse } from "./attendance.mapper";
import { AttendanceError } from "./attendance.repository";
import { AttendanceService } from "./attendance.service";

const id = (value: string | number) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new AttendanceError("INVALID_ATTENDANCE");
  return parsed;
};

const instant = (value: Date | string | null | undefined) => {
  if (value === null || value === undefined) return value;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new AttendanceError("INVALID_ATTENDANCE");
  return parsed;
};

export class AttendanceController {
  constructor(private readonly service: AttendanceService) {}
  async create(input: { actor: AttendanceActor; command: CreateManualWorkDayCommand }) {
    return toWorkDayRecordResponse(await this.service.createManualWorkDay(input.actor, {
      ...input.command, employeeId: id(input.command.employeeId), branchId: id(input.command.branchId),
      clockInAt: instant(input.command.clockInAt), clockOutAt: instant(input.command.clockOutAt),
    }));
  }
  async correct(input: { actor: AttendanceActor; id: string | number; command: CorrectWorkDayCommand }) {
    return toWorkDayRecordResponse(await this.service.correctWorkDay(input.actor, id(input.id), {
      ...input.command, clockInAt: instant(input.command.clockInAt), clockOutAt: instant(input.command.clockOutAt),
    }));
  }
  async list(input: { actor: AttendanceActor; filter: Omit<WorkDayRangeFilter, "employeeId" | "branchId"> & { employeeId?: string | number; branchId?: string | number } }) {
    const filter = { ...input.filter, employeeId: input.filter.employeeId === undefined ? undefined : id(input.filter.employeeId), branchId: input.filter.branchId === undefined ? undefined : id(input.filter.branchId) };
    return (await this.service.findForPayrollRange(input.actor, filter)).map(toWorkDayRecordResponse);
  }
}
