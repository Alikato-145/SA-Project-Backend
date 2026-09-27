export type AttendanceActor = { accountId: number };
export type WorkDayStatus = "present" | "late" | "absent" | "leave" | "weekly_holiday" | "public_holiday";

export type CreateManualWorkDayCommand = {
  employeeId: number;
  branchId: number;
  workDate: string;
  status: WorkDayStatus;
  clockInAt?: Date | null;
  clockOutAt?: Date | null;
  lateMinutes: number;
  isDeductible: boolean;
  note?: string | null;
};

export type CorrectWorkDayCommand = Partial<
  Pick<CreateManualWorkDayCommand, "status" | "clockInAt" | "clockOutAt" | "lateMinutes" | "isDeductible" | "note">
>;

export type WorkDayRecord = CreateManualWorkDayCommand & {
  id: number;
  entrySource: "manual" | "import" | "biometric";
  createdByUserAccountId: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type WorkDayRangeFilter = {
  employeeId?: number;
  branchId?: number;
  startDate: string;
  endDate: string;
};

export type WorkDayRecordResponse = Omit<WorkDayRecord, "createdByUserAccountId" | "createdAt" | "updatedAt">;
