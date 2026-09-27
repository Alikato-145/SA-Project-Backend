export type OvertimeActor = {
  accountId: number;
  scope: "self" | "department" | "branch" | "all";
};
export type OvertimeType = "hourly" | "rest_day" | "public_holiday";
export type SubmitOvertimeCommand = {
  employeeId: number;
  overtimeDate: string;
  overtimeType: OvertimeType;
  hours?: string | null;
  dayUnits?: string | null;
  workDayRecordId?: number | null;
  reason?: string | null;
};
export type OvertimeRecord = {
  id: number;
  employeeId: number;
  workDayRecordId: number | null;
  overtimeDate: string;
  overtimeType: OvertimeType;
  hours: string | null;
  dayUnits: string | null;
  reason: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  requestedByUserAccountId: number;
  submittedAt: Date;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
export type OvertimeResponse = Pick<
  OvertimeRecord,
  "id" | "employeeId" | "workDayRecordId" | "overtimeDate" | "overtimeType" |
  "hours" | "dayUnits" | "reason" | "status"
>;
