import type {
  ApplicableSchedule,
  BranchSchedule,
  BranchScheduleOverride,
  BranchScheduleOverrideResponse,
  BranchScheduleResponse,
} from "./branch-schedule.dto";

export const toBranchScheduleResponse = (
  schedule: BranchSchedule,
): BranchScheduleResponse => ({
  id: schedule.id,
  branchId: schedule.branchId,
  workStartTime: schedule.workStartTime,
  standardCloseTime: schedule.standardCloseTime,
  lateGraceMinutes: schedule.lateGraceMinutes,
  effectiveFrom: schedule.effectiveFrom,
  effectiveTo: schedule.effectiveTo,
});

export const toBranchScheduleOverrideResponse = (
  override: BranchScheduleOverride,
): BranchScheduleOverrideResponse => ({
  id: override.id,
  branchId: override.branchId,
  scheduleDate: override.scheduleDate,
  isClosed: override.isClosed,
  workStartTime: override.workStartTime,
  closeTime: override.closeTime,
  reason: override.reason,
});

export const toApplicableScheduleResponse = (applicable: ApplicableSchedule) => {
  if (applicable.kind === "schedule") {
    return { kind: applicable.kind, schedule: toBranchScheduleResponse(applicable.schedule) };
  }
  if (applicable.kind === "override") {
    return { kind: applicable.kind, override: toBranchScheduleOverrideResponse(applicable.override) };
  }
  return applicable;
};
