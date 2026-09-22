import type { LeaveRequest, LeaveResponse } from "./leave.dto";

export const toLeaveResponse = (value: LeaveRequest): LeaveResponse => ({
  id: value.id,
  employeeId: value.employeeId,
  originalLeaveTypeId: value.originalLeaveTypeId,
  finalLeaveTypeId: value.finalLeaveTypeId,
  startDate: value.startDate,
  endDate: value.endDate,
  requestedDays: value.requestedDays,
  status: value.status,
  reason: value.reason,
});
