import type { AdvanceRecord, AdvanceResponse } from "./advance.dto";
export const toAdvanceResponse = (row: AdvanceRecord): AdvanceResponse => ({
  id: row.id, employeeId: row.employeeId, requestMonth: row.requestMonth,
  amount: row.amount, reason: row.reason, status: row.status, decisionNote: row.decisionNote,
});
