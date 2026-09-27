export type DebtActor = { accountId: number };
export type DebtTransaction = {
  id: number; employeeId: number; debtTypeId: number;
  transactionKind: "charge" | "adjustment" | "reversal";
  transactionDate: string; description: string; amount: string;
  originalTransactionId: number | null; recordedByUserAccountId: number;
  settledInPayrollRecordId: number | null; settledAt: Date | null;
  createdAt: Date; updatedAt: Date;
};
export type RecordDebtCommand = {
  employeeId: number; debtTypeId: number;
  transactionKind: "charge" | "adjustment";
  amount: string; description: string;
};
