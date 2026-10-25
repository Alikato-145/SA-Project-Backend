import type { Payment, PaymentGroupRow, PaymentSummary, PaymentSummaryCounts } from "./payroll-payment.types";
export const toPaymentLifecycleDto = (p: Payment) => ({
  id: String(p.id), status: p.status, amount: p.amount,
  promptpay_phone: p.promptpayPhoneSnapshot, bank_code: p.bankCodeSnapshot,
  account_holder_name: p.accountHolderNameSnapshot, account_number_last4: p.accountNumberLast4Snapshot,
  prepared_at: p.preparedAt.toISOString(), prepared_by_user_account_id: String(p.preparedByUserAccountId),
  paid_at: p.paidAt?.toISOString() ?? null, paid_by_user_account_id: p.paidByUserAccountId ? String(p.paidByUserAccountId) : null, reference_no: p.referenceNo,
  cancelled_at: p.cancelledAt?.toISOString() ?? null, cancelled_by_user_account_id: p.cancelledByUserAccountId ? String(p.cancelledByUserAccountId) : null, cancellation_reason: p.cancellationReason,
});
const countsDto = (r: PaymentSummaryCounts) => ({ employee_count: r.employeeCount, payable_count: r.payableCount, paid_count: r.paidCount, outstanding_count: r.outstandingCount, total_payable: r.totalPayable, total_paid: r.totalPaid, total_outstanding: r.totalOutstanding, complete: r.complete });
export const toPaymentSummaryDto = (r: PaymentSummary) => ({ branches: r.branches.map(b => ({ branch_id: String(b.branchId), branch_name: b.branchName, ...countsDto(b) })), totals: countsDto(r.totals) });
export const toPayrollPaymentResponseDto = (r: PaymentGroupRow) => ({
  payroll_record_id: String(r.recordId), employee_id: r.employeeId, employee_code: r.employeeCode, employee_name: r.employeeName, branch_id: String(r.branchId), branch_name: r.branchName,
  group: r.group, payment_method: r.paymentMethod, amount: r.amount, status: r.amount === "0.00" ? "zero" : r.payment?.status ?? "unprepared", missing_destination: r.missingDestination,
  payment: r.payment ? toPaymentLifecycleDto(r.payment) : null,
  payment_history: (r.paymentHistory ?? []).filter(p => p.status === "cancelled").map(toPaymentLifecycleDto),
  qr_available: !r.member && r.payment?.status === "prepared" && r.payment.paymentMethod === "transfer" && !!r.payment.promptpayPhoneSnapshot,
});
