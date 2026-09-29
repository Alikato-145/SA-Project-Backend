import type { OperationActor } from "../../core/auth/operation-actor";
export type LeaveActor = OperationActor & {
  accountId: number;
  scope: "self" | "department" | "branch" | "all";
};

export type SubmitLeaveCommand = {
  employeeId: number;
  leaveTypeId: number;
  startDate: string;
  endDate: string;
  reason?: string | null;
  isRetroactive?: boolean;
};

export type UpdateLeaveCommand = Omit<SubmitLeaveCommand, "employeeId">;

export type LeaveRequest = {
  id: number;
  employeeId: number;
  originalLeaveTypeId: number;
  finalLeaveTypeId: number | null;
  startDate: string;
  endDate: string;
  requestedDays: string;
  reason: string | null;
  status: "draft" | "pending" | "approved" | "rejected" | "cancelled";
  isRetroactive: boolean;
  submittedByUserAccountId: number;
  submittedAt: Date;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type LeaveDay = {
  id: number;
  leaveRequestId: number;
  workDayRecordId: number | null;
  leaveTypeId: number;
  leaveDate: string;
  dayAmount: string;
  isPaid: boolean;
  isDeductible: boolean;
  quotaConsumed: string;
};

export type LeaveType = {
  id: number;
  nameTh: string;
  quotaType: "fixed" | "by_seniority" | "none";
  isDeductible: boolean;
  requiresDocument: boolean;
  allowExceed: boolean;
  isActive: boolean;
};

export type LeaveTypeResponse = Pick<LeaveType, "id" | "nameTh" | "requiresDocument">;

export type LeaveQuota = {
  id: number;
  employeeId: number;
  leaveTypeId: number;
  quotaYear: number;
  entitledDays: string;
  usedDays: string;
  frozenAt: Date | null;
};

export type ApprovedLeaveInput = {
  employeeId: number;
  date: string;
  leaveTypeId: number;
  isPaid: boolean;
  isDeductible: boolean;
  quotaConsumed: string;
};

export type LeaveResponse = {
  id: number;
  employeeId: number;
  originalLeaveTypeId: number;
  finalLeaveTypeId: number | null;
  startDate: string;
  endDate: string;
  requestedDays: string;
  status: LeaveRequest["status"];
  reason: string | null;
  isRetroactive: boolean;
};
