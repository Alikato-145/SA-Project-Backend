import { and, asc, eq, inArray } from "drizzle-orm";
import type { DatabaseExecutor } from "../../core/db/transaction";
import { branches } from "../branch/branch.schema";
import { employees } from "../employee/employee.schema";
import { employmentAssignments } from "../employment-assignment/employment-assignment.schema";
import { payrollPayments } from "./payroll-payment.schema";
import { payrollPeriods, payrollRecords } from "./payroll.schema";
import type { NewPayment, PaymentRecord, Payment } from "./payroll-payment.types";
export interface PayrollPaymentRepository {
  period(e: DatabaseExecutor, id: string): Promise<{
    status: string;
  } | null>;
  records(e: DatabaseExecutor, periodId: string, branchId?: string): Promise<PaymentRecord[]>;
  insert(e: DatabaseExecutor, rows: NewPayment[]): Promise<void>;
  findIncludingHistory(e: DatabaseExecutor, paymentId: string): Promise<Payment | null>;
  transition(e: DatabaseExecutor, paymentId: string, changes: Partial<Payment>): Promise<Payment | null>;
  find(e: DatabaseExecutor, paymentId: string): Promise<PaymentRecord | null>;
}
const projection = { recordId: payrollRecords.id, employeeId: employees.id, employeeCode: employees.employeeCode, firstName: employees.firstName, lastName: employees.lastName, branchId: employmentAssignments.branchId, branchName: branches.name, member: payrollRecords.isSocialSecurityMemberSnapshot, amount: payrollRecords.netPay, payment: payrollPayments };
const project = (r: {
  recordId: number;
  employeeId: number;
  employeeCode: string;
  firstName: string;
  lastName: string;
  branchId: number;
  branchName: string;
  member: boolean;
  amount: string;
  payment: typeof payrollPayments.$inferSelect | null;
}): PaymentRecord => ({ ...r, employeeId: String(r.employeeId), employeeName: `${r.firstName} ${r.lastName}` });
const recordsQuery = (e: DatabaseExecutor) => e.select(projection).from(payrollRecords).innerJoin(employees, eq(employees.id, payrollRecords.employeeId)).innerJoin(employmentAssignments, eq(employmentAssignments.id, payrollRecords.employmentAssignmentId)).innerJoin(branches, eq(branches.id, employmentAssignments.branchId)).leftJoin(payrollPayments, and(eq(payrollPayments.payrollRecordId, payrollRecords.id), inArray(payrollPayments.status, ["prepared", "paid"])));
export const payrollPaymentRepository: PayrollPaymentRepository = {
  async period(e, id) { const [r] = await e.select({ status: payrollPeriods.status }).from(payrollPeriods).where(eq(payrollPeriods.id, Number(id))); return r ?? null; },
  async records(e, periodId, branchId) { const rows = (await recordsQuery(e).where(and(eq(payrollRecords.payrollPeriodId, Number(periodId)), eq(payrollRecords.status, "locked"), branchId ? eq(employmentAssignments.branchId, Number(branchId)) : undefined)).orderBy(asc(branches.id), asc(employees.employeeCode))).map(project);
    if (!rows.length) return rows;
    const history = await e.select().from(payrollPayments).where(inArray(payrollPayments.payrollRecordId, rows.map(r => r.recordId))).orderBy(asc(payrollPayments.id));
    return rows.map(r => ({ ...r, paymentHistory: history.filter(p => p.payrollRecordId === r.recordId) })); },
  async insert(e, rows) { if (rows.length)
    await e.insert(payrollPayments).values(rows); },
  async findIncludingHistory(e, id) { const [r] = await e.select().from(payrollPayments).where(eq(payrollPayments.id, Number(id))).for("update"); return r ?? null; },
  async transition(e, id, changes) { const [r] = await e.update(payrollPayments).set(changes).where(and(eq(payrollPayments.id, Number(id)), eq(payrollPayments.status, "prepared"))).returning(); return r ?? null; },
  async find(e, id) { const [r] = await recordsQuery(e).where(eq(payrollPayments.id, Number(id))); return r ? project(r) : null; },
};
