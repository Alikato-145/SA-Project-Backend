import type { OvertimeRecord, OvertimeResponse } from "./overtime.dto";
export const toOvertimeResponse = (value: OvertimeRecord): OvertimeResponse => ({
  id: value.id,
  employeeId: value.employeeId,
  workDayRecordId: value.workDayRecordId,
  overtimeDate: value.overtimeDate,
  overtimeType: value.overtimeType,
  hours: value.hours,
  dayUnits: value.dayUnits,
  reason: value.reason,
  status: value.status,
});
