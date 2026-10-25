import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { payrollPayments } from "./payroll-payment.schema";
export type Payment = typeof payrollPayments.$inferSelect;
export type NewPayment = typeof payrollPayments.$inferInsert;
export interface PaymentCommand {
  actor: AuthenticatedActor;
  requestId: string;
  periodId: string;
  branchId?: string;
}
export interface PaymentRecord {
  recordId: number;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  branchId: number;
  branchName: string;
  member: boolean;
  amount: string;
  payment: Payment | null;
  paymentHistory?: Payment[];
}
export type PaymentGroup = "social_security" | "cash" | "transfer";
export interface PaymentGroupRow extends PaymentRecord {
  group: PaymentGroup;
  paymentMethod: "cash" | "transfer";
  missingDestination: string | null;
}

export interface PaymentLifecycleCommand {
  actor: AuthenticatedActor;
  requestId: string;
  paymentId: string;
}
export interface PaymentSummaryCounts {
  employeeCount: number;
  payableCount: number;
  paidCount: number;
  outstandingCount: number;
  totalPayable: string;
  totalPaid: string;
  totalOutstanding: string;
  complete: boolean;
}
export interface PaymentSummary {
  branches: (PaymentSummaryCounts & { branchId: number; branchName: string })[];
  totals: PaymentSummaryCounts;
}
