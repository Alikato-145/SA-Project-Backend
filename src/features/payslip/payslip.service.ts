import { createDocumentStorage, documentSha256, type DocumentStorage } from "../../core/storage/document-storage";
import { createSmtpMailer, type PayslipMailer } from "../../core/mail/smtp-mailer";
import { renderPayslip } from "./payslip.document.service";
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
export const createPayslipService = (dependencies: { rootExecutor: DatabaseExecutor; transactionRunner: TransactionRunner; actions: ActionObserver; domain: DomainAuditObserver; storage?: DocumentStorage; mailer?: PayslipMailer }) => ({
  async generate(actor: AuthenticatedActor, recordId: string, requestId: string) {
    const context = createActionContext({ actor, requestId, actionBase: "payroll.payslip.generate", target: { tableName: "payslips", recordId } });
    return dependencies.actions.observeMutation(context, () => dependencies.transactionRunner.transaction(async (executor) => {
      allScope(actor);
      const record = await payslipRepository.findLockedRecord(executor, recordId);
      if (!record) throw new ApplicationError("RESOURCE_NOT_FOUND");
      const existing = await payslipRepository.findByPayrollRecord(executor, recordId);
      if (existing && (!existing.fileStorageKey.endsWith(".json") || existing.status !== "generated")) {
        return dependencies.domain.complete(existing, await dependencies.domain.record(executor, context, { newData: { payslip_id: existing.id, payroll_record_id:record.id, reused:true } }));
      }
      const content = await renderPayslip(record);
      const sha256 = documentSha256(content), storageKey = `payslips/${record.id}/${sha256}.pdf`;
      await (dependencies.storage ?? createDocumentStorage()).put(storageKey, content);
      let id: string | null;
      try { id = existing ? await payslipRepository.upgradeLegacyFile(executor,existing.id,existing.fileStorageKey,storageKey,sha256) : await payslipRepository.insert(executor, { payrollRecordId: record.id, storageKey, sha256, actorId: actor.accountId }); }
      catch (error) { const value=error as {code?:string;cause?:{code?:string}};if ((value.code ?? value.cause?.code) === "23505") throw new ApplicationError("STATE_CONFLICT"); throw error; }
      if (!id) throw new ApplicationError("STATE_CONFLICT");
      const created = await payslipRepository.find(executor, id);
      if (!created) throw new ApplicationError("STATE_CONFLICT");
      return dependencies.domain.complete(created, await dependencies.domain.record(executor, context, { oldData:existing ? {storage_key:existing.fileStorageKey,sha256:existing.fileSha256}:undefined, newData: { payroll_record_id: record.id, sha256: created.fileSha256,legacy_upgraded:Boolean(existing) } }));
    }));
  },
  async mine(actor: AuthenticatedActor, requestId: string) {
    const context = createActionContext({ actor, requestId, actionBase: "payroll.payslip.list", target: { tableName: "payslips", recordId: "collection" } });
    return dependencies.actions.observeRead(context, async () => {
      if (!actor.employeeId) throw new ApplicationError("FORBIDDEN_SCOPE");
      return payslipRepository.listForEmployee(dependencies.rootExecutor, actor.employeeId);
    });
  },
  async get(actor: AuthenticatedActor, payslipId: string, requestId: string) {
    const context = createActionContext({ actor, requestId, actionBase: "payroll.payslip.read", target: { tableName: "payslips", recordId: payslipId } });
    return dependencies.actions.observeRead(context, async () => {
      const found = await payslipRepository.find(dependencies.rootExecutor, payslipId);
      if (!found || found.status !== "generated") throw new ApplicationError("RESOURCE_NOT_FOUND");
      ownOrAdmin(actor, found);
      return found;
    });
  },
  async deliver(actor: AuthenticatedActor, payslipId: string, recipientEmail: string, requestId: string) {
    const observation = createActionContext({ actor, requestId, actionBase: "payroll.payslip.deliver", target: { tableName: "payslips", recordId: payslipId } });
    return dependencies.actions.observeMutation(observation, async () => {
      allScope(actor);
      if (recipientEmail.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) throw new ApplicationError("VALIDATION_ERROR");
      const started = await dependencies.transactionRunner.transaction(async (executor) => {
        const found = await payslipRepository.find(executor, payslipId, true);
        if (!found || found.status !== "generated") throw new ApplicationError("RESOURCE_NOT_FOUND");
        const previous = await payslipRepository.deliveryForRequest(executor, payslipId, actor.accountId, requestId);
        if (previous) {
          if (previous.recipientEmail !== recipientEmail || previous.status === "pending") throw new ApplicationError("STATE_CONFLICT");
          return { previous, attempt: null, bytes: null, filename: "" };
        }
        if (await payslipRepository.pendingDelivery(executor, payslipId)) throw new ApplicationError("STATE_CONFLICT", { publicMessage: "มีการส่งสลิปนี้ที่ยังไม่ทราบผล กรุณาตรวจสอบประวัติการส่งก่อนลองใหม่" });
        const bytes = await (dependencies.storage ?? createDocumentStorage()).read(found.fileStorageKey, found.fileSha256);
        const attempt = await payslipRepository.addDelivery(executor, payslipId, recipientEmail);
        if (!attempt) throw new ApplicationError("STATE_CONFLICT");
        await dependencies.domain.record(executor, createActionContext({ actor, requestId, actionBase: "payroll.delivery.start", target: { tableName: "email_delivery_logs", recordId: attempt.id } }), { newData: { payslip_id: payslipId, status: "pending" } });
        return { previous: null, attempt, bytes, filename: `payslip-${found.payrollRecordId}.pdf` };
      });
      let status: "sent" | "failed" = "sent", providerMessageId: string | null = null;
      if (started.attempt) {
        try { providerMessageId = await (dependencies.mailer ?? createSmtpMailer()).send({ recipient: recipientEmail, attemptId: started.attempt.id, bytes: started.bytes!, filename: started.filename }); }
        catch { status = "failed"; }
      }
      return dependencies.transactionRunner.transaction(async (executor) => {
        const attempt = started.previous ?? await payslipRepository.finishDelivery(executor, started.attempt!.id, status, providerMessageId);
        if (!attempt) throw new ApplicationError("STATE_CONFLICT");
        const receipt = await dependencies.domain.record(executor, createActionContext({ actor, requestId, actionBase: "payroll.payslip.deliver", target: { tableName: "email_delivery_logs", recordId: attempt.id } }), { newData: { payslip_id: payslipId, status: attempt.status } });
        return dependencies.domain.complete(attempt, receipt);
      });
    });
  },
  async download(actor: AuthenticatedActor, payslipId: string, requestId: string) {
    const context = createActionContext({ actor, requestId, actionBase: "payroll.payslip.download", target: { tableName: "payslips", recordId: payslipId } });
    return dependencies.actions.observeRead(context, async () => {
      const found = await payslipRepository.find(dependencies.rootExecutor, payslipId);
      if (!found || found.status !== "generated") throw new ApplicationError("RESOURCE_NOT_FOUND");
      ownOrAdmin(actor, found);
      const bytes = await (dependencies.storage ?? createDocumentStorage()).read(found.fileStorageKey, found.fileSha256);
      return { bytes, filename: `payslip-${found.payrollRecordId}.pdf` };
    });
  },
  async resolveDelivery(actor:AuthenticatedActor,payslipId:string,attemptId:string,outcome:"sent"|"failed",reason:string,providerReference:string|undefined,requestId:string) {
    const context=createActionContext({actor,requestId,actionBase:"payroll.delivery.resolve",target:{tableName:"email_delivery_logs",recordId:attemptId}});
    return dependencies.actions.observeMutation(context,()=>dependencies.transactionRunner.transaction(async executor=>{
      allScope(actor);
      if(!["sent","failed"].includes(outcome)||reason.trim().length<10||reason.length>1000||(outcome==="sent"&&(!providerReference?.trim()||providerReference.length>255)))throw new ApplicationError("VALIDATION_ERROR",{publicMessage:"ระบุเหตุผลตรวจสอบอย่างน้อย 10 ตัวอักษร และ reference จากผู้ให้บริการเมื่อยืนยันว่าส่งแล้ว"});
      const current=await payslipRepository.findDeliveryForUpdate(executor,payslipId,attemptId);
      if(!current)throw new ApplicationError("RESOURCE_NOT_FOUND");
      if(current.status!=="pending" || Date.now()-current.attemptedAt.valueOf()<10*60*1000)throw new ApplicationError("STATE_CONFLICT",{publicMessage:"แก้ผลตรวจสอบได้เฉพาะรายการค้างเกิน 10 นาที เพื่อไม่เปลี่ยนรายการที่กำลังส่ง"});
      const resolved=await payslipRepository.finishDelivery(executor,attemptId,outcome,outcome==="sent"?providerReference!.trim():null);
      if(!resolved)throw new ApplicationError("STATE_CONFLICT");
      return dependencies.domain.complete(resolved,await dependencies.domain.record(executor,context,{oldData:{status:current.status},newData:{status:resolved.status,provider_reference:providerReference ?? null},reason:reason.trim()}));
    }));
  },
  async deliveries(actor: AuthenticatedActor, payslipId: string, requestId: string) {
    const context = createActionContext({ actor, requestId, actionBase: "payroll.payslip.delivery-list", target: { tableName: "email_delivery_logs", recordId: payslipId } });
    return dependencies.actions.observeRead(context, async () => {
      allScope(actor);
      if (!await payslipRepository.find(dependencies.rootExecutor, payslipId)) throw new ApplicationError("RESOURCE_NOT_FOUND");
      return payslipRepository.listDeliveries(dependencies.rootExecutor, payslipId);
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
