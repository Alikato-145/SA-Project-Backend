import type { DebtTransaction } from "./debt.dto";
export const toDebtResponse = (row: DebtTransaction) => ({
  id: row.id, employeeId: row.employeeId, debtTypeId: row.debtTypeId,
  transactionKind: row.transactionKind, transactionDate: row.transactionDate,
  description: row.description, amount: row.amount,
  originalTransactionId: row.originalTransactionId,
  settledInPayrollRecordId: row.settledInPayrollRecordId,
});
