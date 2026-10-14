import type { PayslipRow } from "./payslip.repository";

export const toPayslipDto = (row: PayslipRow) => ({ id: row.id, payroll_record_id: row.payrollRecordId,
  employee_id: row.employeeId, status: row.status, generated_at: row.generatedAt.toISOString(),
  total_earnings: row.totalEarnings, total_deductions: row.totalDeductions, net_pay: row.netPay });
export const toDeliveryDto = (row: { id: string; recipientEmail?: string; status: string; attemptedAt: Date }) => ({
  id: row.id, ...(row.recipientEmail ? { recipient_email: row.recipientEmail } : {}), status: row.status, attempted_at: row.attemptedAt.toISOString(),
});
