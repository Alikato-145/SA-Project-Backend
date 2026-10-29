import type { CreateManualWorkDayCommand } from "./attendance.dto";
import type { ApplicableSchedule } from "../branch-schedule/branch-schedule.dto";

export function defaultScheduledTimes(command: CreateManualWorkDayCommand, applicable: ApplicableSchedule): CreateManualWorkDayCommand {
  if (command.status !== "present" || command.lateMinutes !== 0 || command.clockInAt || command.clockOutAt || applicable.kind === "none") return command;
  if (applicable.kind === "override" && applicable.override.isClosed) return command;
  const start = applicable.kind === "schedule" ? applicable.schedule.workStartTime : applicable.override.workStartTime;
  const end = applicable.kind === "schedule" ? applicable.schedule.standardCloseTime : applicable.override.closeTime;
  if (!start || !end) return command;
  const time = (value: string) => `${value.length === 5 ? `${value}:00` : value}`;
  return { ...command, clockInAt: new Date(`${command.workDate}T${time(start)}+07:00`), clockOutAt: new Date(`${command.workDate}T${time(end)}+07:00`), note: ["เวลาตามตารางสาขา (ไม่ได้ระบุเวลาเข้าออก)", command.note?.trim()].filter(Boolean).join(" · ") };
}
