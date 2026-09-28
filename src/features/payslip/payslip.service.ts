import { createHash } from "node:crypto";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { assertPayrollMutationAccess } from "../payroll/payroll.authorization";
import { ApplicationError } from "../../core/errors/application.error";
import type { TransactionRunner, DatabaseExecutor } from "../../core/db/transaction";
import type { ActionObserver } from "../../core/audit/action-observer";
import type { DomainAuditObserver } from "../../core/audit/domain-audit-observer";
import { createActionContext } from "../../core/audit/action-context";
import { payslipRepository, type PayslipRow } from "./payslip.repository";

const allScope = (actor: AuthenticatedActor) => { assertPayrollMutationAccess(actor); };
const ownOrAdmin = (actor: AuthenticatedActor, row: PayslipRow) => {
  if (actor.employeeId === row.employeeId) return;
  allScope(actor);
};
const summary = (row: PayslipRow) => ({ id: row.id, payroll_record_id: row.payrollRecordId, employee_id: row.employeeId, status: row.status, generated_at: row.generatedAt.toISOString(), total_earnings: row.totalEarnings, total_deductions: row.totalDeductions, net_pay: row.netPay });

export const createPayslipService = (dependencies: { rootExecutor: DatabaseExecutor; transactionRunner: TransactionRunner; actions: ActionObserver; domain: DomainAuditObserver }) => ({
  async generate(actor: AuthenticatedActor, recordId: string, requestId: string) {
    const context = createActionContext({ actor, requestId, actionBase: "payroll.payslip.generate", target: { tableName: "payslips", recordId } });
    return dependencies.actions.observeMutation(context, () => dependencies.transactionRunner.transaction(async (executor) => {
      allScope(actor);
      const record = await payslipRepository.findLockedRecord(executor, recordId);
      if (!record) throw new ApplicationError("RESOURCE_NOT_FOUND");
      const content = JSON.stringify({ payroll_record_id: record.id, employee_id: record.employeeId, total_earnings: record.totalEarnings, total_deductions: record.totalDeductions, net_pay: record.netPay });
      let id: string | null;
      try { id = await payslipRepository.insert(executor, { payrollRecordId: record.id, storageKey: `payslips/${record.id}.json`, sha256: createHash("sha256").update(content).digest("hex"), actorId: actor.accountId }); }
      catch (error) { if ((error as { code?: string }).code === "23505") throw new ApplicationError("STATE_CONFLICT"); throw error; }
      if (!id) throw new ApplicationError("STATE_CONFLICT");
      const created = await payslipRepository.find(executor, id);
      if (!created) throw new ApplicationError("STATE_CONFLICT");
      return dependencies.domain.complete(summary(created), await dependencies.domain.record(executor, context, { newData: { payroll_record_id: record.id, sha256: created.fileSha256 } }));
    }));
  },
  async mine(actor: AuthenticatedActor, requestId: string) {
    const context = createActionContext({ actor, requestId, actionBase: "payroll.payslip.list", target: { tableName: "payslips", recordId: "collection" } });
    return dependencies.actions.observeRead(context, async () => {
      if (!actor.employeeId) throw new ApplicationError("FORBIDDEN_SCOPE");
      return (await payslipRepository.listForEmployee(dependencies.rootExecutor, actor.employeeId)).map(summary);
    });
  },
  async get(actor: AuthenticatedActor, payslipId: string, requestId: string) {
    const context = createActionContext({ actor, requestId, actionBase: "payroll.payslip.read", target: { tableName: "payslips", recordId: payslipId } });
    return dependencies.actions.observeRead(context, async () => {
      const found = await payslipRepository.find(dependencies.rootExecutor, payslipId);
      if (!found || found.status !== "generated") throw new ApplicationError("RESOURCE_NOT_FOUND");
      ownOrAdmin(actor, found);
      return summary(found);
    });
  },
  async deliver(actor: AuthenticatedActor, payslipId: string, recipientEmail: string, requestId: string) {
    const context = createActionContext({ actor, requestId, actionBase: "payroll.payslip.deliver", target: { tableName: "email_delivery_logs", recordId: payslipId } });
    return dependencies.actions.observeMutation(context, () => dependencies.transactionRunner.transaction(async (executor) => {
      allScope(actor);
      const found = await payslipRepository.find(executor, payslipId);
      if (!found || found.status !== "generated" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) throw new ApplicationError("VALIDATION_ERROR");
      const delivery = await payslipRepository.addDelivery(executor, payslipId, recipientEmail);
      if (!delivery) throw new ApplicationError("STATE_CONFLICT");
      return dependencies.domain.complete(delivery, await dependencies.domain.record(executor, context, { newData: { payslip_id: payslipId, status: delivery.status } }));
    }));
  },
  async deliveries(actor: AuthenticatedActor, payslipId: string, requestId: string) {
    const context = createActionContext({ actor, requestId, actionBase: "payroll.payslip.delivery-list", target: { tableName: "email_delivery_logs", recordId: payslipId } });
    return dependencies.actions.observeRead(context, async () => {
      allScope(actor);
      if (!await payslipRepository.find(dependencies.rootExecutor, payslipId)) throw new ApplicationError("RESOURCE_NOT_FOUND");
      return payslipRepository.listDeliveries(dependencies.rootExecutor, payslipId).then((rows) => rows.map((row) => ({ id: row.id, recipient_email: row.recipientEmail, status: row.status, attempted_at: row.attemptedAt.toISOString() })));
    });
  },
  async void(actor: AuthenticatedActor, payslipId: string, requestId: string) {
    const context = createActionContext({ actor, requestId, actionBase: "payroll.payslip.void", target: { tableName: "payslips", recordId: payslipId } });
    return dependencies.actions.observeMutation(context, () => dependencies.transactionRunner.transaction(async (executor) => {
      allScope(actor);
      if (!await payslipRepository.void(executor, payslipId, actor.accountId)) throw new ApplicationError("STATE_CONFLICT");
      return dependencies.domain.complete({ id: payslipId, status: "voided" }, await dependencies.domain.record(executor, context, { newData: { status: "voided" } }));
    }));
  },
});
export type PayslipService = ReturnType<typeof createPayslipService>;
