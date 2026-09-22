export type ScheduleActor = {
  accountId: number;
};

export type CreateBranchScheduleCommand = {
  branchId: number;
  workStartTime: string;
  standardCloseTime: string;
  lateGraceMinutes: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
};

export type UpdateBranchScheduleCommand = Partial<
  Omit<CreateBranchScheduleCommand, "branchId">
>;

export type UpsertScheduleOverrideCommand = {
  branchId: number;
  scheduleDate: string;
  isClosed: boolean;
  workStartTime?: string | null;
  closeTime?: string | null;
  reason?: string | null;
};

export type BranchSchedule = CreateBranchScheduleCommand & {
  id: number;
  createdAt: Date;
  updatedAt: Date;
};

export type BranchScheduleOverride = {
  id: number;
  branchId: number;
  scheduleDate: string;
  isClosed: boolean;
  workStartTime: string | null;
  closeTime: string | null;
  reason: string | null;
  createdByUserAccountId: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ApplicableSchedule =
  | { kind: "override"; override: BranchScheduleOverride }
  | { kind: "schedule"; schedule: BranchSchedule }
  | { kind: "none" };

export type BranchScheduleResponse = Omit<BranchSchedule, "createdAt" | "updatedAt">;
export type BranchScheduleOverrideResponse = Omit<
  BranchScheduleOverride,
  "createdAt" | "updatedAt" | "createdByUserAccountId"
>;
