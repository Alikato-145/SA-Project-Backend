import type { PaymentGroupRow } from "./payroll-payment.types";
export const toPayrollPaymentResponseDto = (r: PaymentGroupRow) => ({
  payroll_record_id: String(r.recordId), employee_id: r.employeeId, employee_code: r.employeeCode, employee_name: r.employeeName, branch_id: String(r.branchId), branch_name: r.branchName,
  group: r.group, payment_method: r.paymentMethod, amount: r.amount, status: r.amount === "0.00" ? "zero" : r.payment?.status ?? "unprepared", missing_destination: r.missingDestination,
  payment: r.payment ? { id: String(r.payment.id), promptpay_phone: r.payment.promptpayPhoneSnapshot, bank_code: r.payment.bankCodeSnapshot, account_holder_name: r.payment.accountHolderNameSnapshot, account_number_last4: r.payment.accountNumberLast4Snapshot, prepared_at: r.payment.preparedAt.toISOString() } : null,
  qr_available: !r.member && r.payment?.status === "prepared" && r.payment.paymentMethod === "transfer" && !!r.payment.promptpayPhoneSnapshot,
});
