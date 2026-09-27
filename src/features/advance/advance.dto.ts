export type AdvanceActor = { accountId: number };
export type AdvanceRecord = {
  id: number; employeeId: number; requestMonth: string; amount: string;
  status: "pending" | "approved" | "rejected" | "deducted" | "cancelled";
  requestedByUserAccountId: number; requestedAt: Date;
  decidedByUserAccountId: number | null; decidedAt: Date | null;
  decisionNote: string | null; createdAt: Date; updatedAt: Date;
};
export type AdvanceResponse = Pick<AdvanceRecord,
  "id" | "employeeId" | "requestMonth" | "amount" | "status" | "decisionNote">;
