import type { LoanRequest } from "./loan.dto";
export const toLoanRequestResponse=(row:LoanRequest)=>({
 id:row.id,employeeId:row.employeeId,principalAmount:row.principalAmount,installmentCount:row.installmentCount,reason:row.reason,status:row.status,
 requestedAt:row.requestedAt,decidedAt:row.decidedAt,decisionNote:row.decisionNote,loanId:row.loanId,
});
