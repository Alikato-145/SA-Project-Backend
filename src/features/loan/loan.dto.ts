export type LoanActor = { accountId: number };
export type CreateLoanCommand = {
  employeeId: number; principalAmount: string; installmentCount: number;
  firstDueMonth: string; reason: string;
};
export type Loan = {
  id: number; employeeId: number; principalAmount: string; reason: string;
  installmentCount: number; status: "active" | "closed" | "cancelled";
  approvedByUserAccountId: number; approvedAt: Date; closedAt: Date | null;
  createdAt: Date; updatedAt: Date;
};
export type LoanInstallment = {
  id: number; loanId: number; installmentNo: number; duePeriodStart: string;
  amount: string; status: "scheduled" | "deducted" | "waived" | "cancelled";
  deductedAt: Date | null; payrollRecordId: number | null;
  createdAt: Date; updatedAt: Date;
};
export type LoanWithInstallments = { loan: Loan; installments: LoanInstallment[] };
