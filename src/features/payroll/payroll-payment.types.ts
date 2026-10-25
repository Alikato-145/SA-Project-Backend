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
}
export type PaymentGroup = "social_security" | "cash" | "transfer";
export interface PaymentGroupRow extends PaymentRecord {
  group: PaymentGroup;
  paymentMethod: "cash" | "transfer";
  missingDestination: string | null;
}
