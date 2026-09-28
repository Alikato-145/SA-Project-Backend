import { and, asc, eq } from "drizzle-orm";
import type { DatabaseExecutor } from "../../core/db/transaction";
import { emailDeliveryLogs, payslips } from "./payslip.schema";
import { payrollRecords } from "../payroll/payroll.schema";

const id = (value: string) => Number(value);
export type PayslipRow = { id: string; payrollRecordId: string; employeeId: string; status: "generated" | "voided"; generatedAt: Date; netPay: string; totalEarnings: string; totalDeductions: string; fileStorageKey: string; fileSha256: string };
const row = (value: { id: number; payrollRecordId: number; employeeId: number; status: "generated" | "voided"; generatedAt: Date; netPay: string; totalEarnings: string; totalDeductions: string; fileStorageKey: string; fileSha256: string }): PayslipRow => ({ ...value, id: String(value.id), payrollRecordId: String(value.payrollRecordId), employeeId: String(value.employeeId) });
const selection = { id: payslips.id, payrollRecordId: payslips.payrollRecordId, employeeId: payrollRecords.employeeId, status: payslips.status, generatedAt: payslips.generatedAt, netPay: payrollRecords.netPay, totalEarnings: payrollRecords.totalEarnings, totalDeductions: payrollRecords.totalDeductions, fileStorageKey: payslips.fileStorageKey, fileSha256: payslips.fileSha256 };

export const payslipRepository = {
  async findLockedRecord(executor: DatabaseExecutor, recordId: string) {
    const [record] = await executor.select({ id: payrollRecords.id, employeeId: payrollRecords.employeeId, netPay: payrollRecords.netPay, totalEarnings: payrollRecords.totalEarnings, totalDeductions: payrollRecords.totalDeductions }).from(payrollRecords).where(and(eq(payrollRecords.id, id(recordId)), eq(payrollRecords.status, "locked"))).limit(1);
    return record ? { id: String(record.id), employeeId: String(record.employeeId), netPay: record.netPay, totalEarnings: record.totalEarnings, totalDeductions: record.totalDeductions } : null;
  },
  async insert(executor: DatabaseExecutor, input: { payrollRecordId: string; storageKey: string; sha256: string; actorId: string }) {
    const [created] = await executor.insert(payslips).values({ payrollRecordId: id(input.payrollRecordId), fileStorageKey: input.storageKey, fileSha256: input.sha256, generatedByUserAccountId: id(input.actorId) }).returning({ id: payslips.id });
    return created ? String(created.id) : null;
  },
  async find(executor: DatabaseExecutor, payslipId: string) {
    const [found] = await executor.select(selection).from(payslips).innerJoin(payrollRecords, eq(payrollRecords.id, payslips.payrollRecordId)).where(eq(payslips.id, id(payslipId))).limit(1);
    return found ? row(found) : null;
  },
  async listForEmployee(executor: DatabaseExecutor, employeeId: string) {
    return (await executor.select(selection).from(payslips).innerJoin(payrollRecords, eq(payrollRecords.id, payslips.payrollRecordId)).where(and(eq(payrollRecords.employeeId, id(employeeId)), eq(payslips.status, "generated"))).orderBy(asc(payslips.generatedAt))).map(row);
  },
  async addDelivery(executor: DatabaseExecutor, payslipId: string, recipientEmail: string) {
    const [created] = await executor.insert(emailDeliveryLogs).values({ payslipId: id(payslipId), recipientEmail, status: "sent", sentAt: new Date() }).returning({ id: emailDeliveryLogs.id, status: emailDeliveryLogs.status, attemptedAt: emailDeliveryLogs.attemptedAt });
    return created ? { id: String(created.id), status: created.status, attemptedAt: created.attemptedAt } : null;
  },
  async listDeliveries(executor: DatabaseExecutor, payslipId: string) {
    return (await executor.select({ id: emailDeliveryLogs.id, recipientEmail: emailDeliveryLogs.recipientEmail, status: emailDeliveryLogs.status, attemptedAt: emailDeliveryLogs.attemptedAt }).from(emailDeliveryLogs).where(eq(emailDeliveryLogs.payslipId, id(payslipId))).orderBy(asc(emailDeliveryLogs.attemptedAt))).map((delivery) => ({ id: String(delivery.id), recipientEmail: delivery.recipientEmail, status: delivery.status, attemptedAt: delivery.attemptedAt }));
  },
  async void(executor: DatabaseExecutor, payslipId: string, actorId: string) {
    const [updated] = await executor.update(payslips).set({ status: "voided", voidedAt: new Date(), voidedByUserAccountId: id(actorId) }).where(and(eq(payslips.id, id(payslipId)), eq(payslips.status, "generated"))).returning({ id: payslips.id });
    return updated ? String(updated.id) : null;
  },
};
