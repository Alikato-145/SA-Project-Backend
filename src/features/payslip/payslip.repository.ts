import { and, asc, eq, sql } from "drizzle-orm";
import { auditLogs } from "../audit/audit.schema";
import type { DatabaseExecutor } from "../../core/db/transaction";
import { emailDeliveryLogs, payslips } from "./payslip.schema";
import { payrollItems, payrollPeriods, payrollRecords } from "../payroll/payroll.schema";
import { employees } from "../employee/employee.schema";
import type { PayslipDocumentInput } from "./payslip.document.service";

const id = (value: string) => Number(value);
export type PayslipRow = { id: string; payrollRecordId: string; employeeId: string; status: "generated" | "voided"; generatedAt: Date; netPay: string; totalEarnings: string; totalDeductions: string; fileStorageKey: string; fileSha256: string };
export type DeliveryRow = { id: string; recipientEmail: string; status: "pending" | "sent" | "failed"; attemptedAt: Date };
const row = (value: { id: number; payrollRecordId: number; employeeId: number; status: "generated" | "voided"; generatedAt: Date; netPay: string; totalEarnings: string; totalDeductions: string; fileStorageKey: string; fileSha256: string }): PayslipRow => ({ ...value, id: String(value.id), payrollRecordId: String(value.payrollRecordId), employeeId: String(value.employeeId) });
const selection = { id: payslips.id, payrollRecordId: payslips.payrollRecordId, employeeId: payrollRecords.employeeId, status: payslips.status, generatedAt: payslips.generatedAt, netPay: payrollRecords.netPay, totalEarnings: payrollRecords.totalEarnings, totalDeductions: payrollRecords.totalDeductions, fileStorageKey: payslips.fileStorageKey, fileSha256: payslips.fileSha256 };

export const payslipRepository = {
  async findLockedRecord(executor: DatabaseExecutor, recordId: string): Promise<PayslipDocumentInput | null> {
    const [record] = await executor.select({ id: payrollRecords.id, employeeId: payrollRecords.employeeId,
      netPay: payrollRecords.netPay, totalEarnings: payrollRecords.totalEarnings, totalDeductions: payrollRecords.totalDeductions,
      employeeCode: employees.employeeCode, firstName: employees.firstName, lastName: employees.lastName,
      periodStart: payrollPeriods.startDate, periodEnd: payrollPeriods.endDate, lockedAt: payrollPeriods.lockedAt,
    }).from(payrollRecords).innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRecords.payrollPeriodId))
      .innerJoin(employees, eq(employees.id, payrollRecords.employeeId))
      .where(and(eq(payrollRecords.id, id(recordId)), eq(payrollRecords.status, "locked"))).limit(1).for("update",{of:payrollRecords});
    if (!record) return null;
    const items = await executor.select({ itemType:payrollItems.itemType, description: payrollItems.description, direction: payrollItems.direction, amount: payrollItems.amount, occurredOn: payrollItems.occurredOn })
      .from(payrollItems).where(eq(payrollItems.payrollRecordId, id(recordId))).orderBy(asc(payrollItems.id));
    return { ...record, id: String(record.id), employeeId: String(record.employeeId), employeeName: `${record.firstName} ${record.lastName}`, items };
  },
  async insert(executor: DatabaseExecutor, input: { payrollRecordId: string; storageKey: string; sha256: string; actorId: string }) {
    const [created] = await executor.insert(payslips).values({ payrollRecordId: id(input.payrollRecordId), fileStorageKey: input.storageKey, fileSha256: input.sha256, generatedByUserAccountId: id(input.actorId) }).returning({ id: payslips.id });
    return created ? String(created.id) : null;
  },
  async findByPayrollRecord(executor:DatabaseExecutor,recordId:string) {
    const [found]=await executor.select(selection).from(payslips).innerJoin(payrollRecords,eq(payrollRecords.id,payslips.payrollRecordId)).where(eq(payslips.payrollRecordId,id(recordId))).limit(1);
    return found ? row(found) : null;
  },
  async upgradeLegacyFile(executor:DatabaseExecutor,payslipId:string,oldKey:string,storageKey:string,sha256:string) {
    const [updated]=await executor.update(payslips).set({fileStorageKey:storageKey,fileSha256:sha256}).where(and(eq(payslips.id,id(payslipId)),eq(payslips.fileStorageKey,oldKey),eq(payslips.status,"generated"))).returning({id:payslips.id});
    return updated ? String(updated.id) : null;
  },
  async find(executor: DatabaseExecutor, payslipId: string, lock = false) {
    const query = executor.select(selection).from(payslips).innerJoin(payrollRecords, eq(payrollRecords.id, payslips.payrollRecordId)).where(eq(payslips.id, id(payslipId))).limit(1);
    const [found] = await (lock ? query.for("update", { of: payslips }) : query);
    return found ? row(found) : null;
  },
  async listForEmployee(executor: DatabaseExecutor, employeeId: string) {
    return (await executor.select(selection).from(payslips).innerJoin(payrollRecords, eq(payrollRecords.id, payslips.payrollRecordId)).where(and(eq(payrollRecords.employeeId, id(employeeId)), eq(payslips.status, "generated"))).orderBy(asc(payslips.generatedAt))).map(row);
  },
  async addDelivery(executor: DatabaseExecutor, payslipId: string, recipientEmail: string): Promise<DeliveryRow | null> {
    const [created] = await executor.insert(emailDeliveryLogs).values({ payslipId: id(payslipId), recipientEmail, status: "pending" }).returning();
    return created ? { ...created, id: String(created.id) } : null;
  },
  async pendingDelivery(executor: DatabaseExecutor, payslipId: string): Promise<{ id: number } | null> {
    const [pending] = await executor.select({ id: emailDeliveryLogs.id }).from(emailDeliveryLogs)
      .where(and(eq(emailDeliveryLogs.payslipId, id(payslipId)), eq(emailDeliveryLogs.status, "pending"))).limit(1);
    return pending ?? null;
  },
  async findDeliveryForUpdate(executor:DatabaseExecutor,payslipId:string,attemptId:string):Promise<DeliveryRow|null> {
    const [found]=await executor.select().from(emailDeliveryLogs).where(and(eq(emailDeliveryLogs.payslipId,id(payslipId)),eq(emailDeliveryLogs.id,id(attemptId)))).for("update");
    return found ? {...found,id:String(found.id)} : null;
  },
  async deliveryForRequest(executor: DatabaseExecutor, payslipId: string, actorId: string, requestId: string) {
    const [attempt] = await executor.select({ id: emailDeliveryLogs.id, status: emailDeliveryLogs.status, recipientEmail: emailDeliveryLogs.recipientEmail, attemptedAt: emailDeliveryLogs.attemptedAt })
      .from(emailDeliveryLogs).innerJoin(auditLogs, eq(auditLogs.recordId, sql`${emailDeliveryLogs.id}::text`))
      .where(and(eq(emailDeliveryLogs.payslipId, id(payslipId)), eq(auditLogs.tableName, "email_delivery_logs"),
        eq(auditLogs.action, "payroll.delivery.start.succeeded"), eq(auditLogs.actorUserAccountId, id(actorId)), eq(auditLogs.requestId, requestId))).limit(1);
    return attempt ? { ...attempt, id: String(attempt.id) } : null;
  },
  async finishDelivery(executor: DatabaseExecutor, attemptId: string, status: "sent" | "failed", providerMessageId: string | null): Promise<DeliveryRow | null> {
    const [attempt] = await executor.update(emailDeliveryLogs).set({ status, providerMessageId, sentAt: status === "sent" ? new Date() : null,
      errorMessage: status === "failed" ? "SMTP ไม่รับข้อความหรือการเชื่อมต่อล้มเหลว ตรวจ configuration และลองส่งใหม่" : null,
    }).where(and(eq(emailDeliveryLogs.id, id(attemptId)), eq(emailDeliveryLogs.status, "pending"))).returning();
    return attempt ? { ...attempt, id: String(attempt.id) } : null;
  },
  async listDeliveries(executor: DatabaseExecutor, payslipId: string) {
    return (await executor.select({ id: emailDeliveryLogs.id, recipientEmail: emailDeliveryLogs.recipientEmail, status: emailDeliveryLogs.status, attemptedAt: emailDeliveryLogs.attemptedAt }).from(emailDeliveryLogs).where(eq(emailDeliveryLogs.payslipId, id(payslipId))).orderBy(asc(emailDeliveryLogs.attemptedAt))).map((delivery) => ({ id: String(delivery.id), recipientEmail: delivery.recipientEmail, status: delivery.status, attemptedAt: delivery.attemptedAt }));
  },
  async void(executor: DatabaseExecutor, payslipId: string, actorId: string) {
    const [updated] = await executor.update(payslips).set({ status: "voided", voidedAt: new Date(), voidedByUserAccountId: id(actorId) }).where(and(eq(payslips.id, id(payslipId)), eq(payslips.status, "generated"))).returning({ id: payslips.id });
    return updated ? String(updated.id) : null;
  },
};
