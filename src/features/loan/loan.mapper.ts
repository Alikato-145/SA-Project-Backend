import type { LoanWithInstallments } from "./loan.dto";
const cents = (amount: string) => {
  const [whole, fraction = ""] = amount.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
};
const money = (amount: bigint) => `${amount / 100n}.${String(amount % 100n).padStart(2, "0")}`;
export const toLoanResponse = (value: LoanWithInstallments) => ({
  id: value.loan.id,
  employeeId: value.loan.employeeId,
  principalAmount: value.loan.principalAmount,
  reason: value.loan.reason,
  status: value.loan.status,
  outstandingAmount: money(cents(value.loan.principalAmount) - value.installments
    .filter((row) => row.status === "deducted")
    .reduce((sum, row) => sum + cents(row.amount), 0n)),
  installments: value.installments.map((row) => ({
    id: row.id, installmentNo: row.installmentNo,
    duePeriodStart: row.duePeriodStart, amount: row.amount,
    status: row.status, payrollRecordId: row.payrollRecordId,
  })),
});
