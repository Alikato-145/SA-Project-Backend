import type { OperationActor } from "../../core/auth/operation-actor";
export type AdvanceActor = OperationActor & { accountId: number };
export type AdvanceRecord = {
  id: number; employeeId: number; requestMonth: string; amount: string; reason: string | null;
  status: "pending" | "approved" | "rejected" | "deducted" | "cancelled";
  requestedByUserAccountId: number; requestedAt: Date;
  decidedByUserAccountId: number | null; decidedAt: Date | null;
  decisionNote: string | null; createdAt: Date; updatedAt: Date;
};
export type AdvanceResponse = Pick<AdvanceRecord,
  "id" | "employeeId" | "requestMonth" | "amount" | "reason" | "status" | "decisionNote">;
