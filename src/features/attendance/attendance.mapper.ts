import type { WorkDayRecord, WorkDayRecordResponse } from "./attendance.dto";

export const toWorkDayRecordResponse = (record: WorkDayRecord): WorkDayRecordResponse => ({
  id: record.id,
  employeeId: record.employeeId,
  branchId: record.branchId,
  workDate: record.workDate,
  status: record.status,
  clockInAt: record.clockInAt,
  clockOutAt: record.clockOutAt,
  lateMinutes: record.lateMinutes,
  isDeductible: record.isDeductible,
  note: record.note,
  entrySource: record.entrySource,
});
