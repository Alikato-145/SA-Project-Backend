import { randomUUID } from "node:crypto";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { operationActor } from "../../core/auth/operation-actor";
import type { DatabaseExecutor, TransactionRunner } from "../../core/db/transaction";
import type { ActionObserver } from "../../core/audit/action-observer";
import type { DomainAuditObserver } from "../../core/audit/domain-audit-observer";
import { createActionContext } from "../../core/audit/action-context";
import { ApplicationError } from "../../core/errors/application.error";
import { createDocumentStorage, type DocumentStorage } from "../../core/storage/document-storage";
import type { createEmployeeService } from "../employee/employee.service";
import type { createLeaveRuntimeService } from "../leave/leave.runtime.service";
import { databaseId } from "../../shared/operation-validation";
import { attachmentRepository, type AttachmentOwner, type AttachmentRecord } from "./attachment.repository";

export const validateAttachment = (file: { name: string; mime: string; bytes: Uint8Array }) => {
  const bytes = Buffer.from(file.bytes);
  const valid = (file.mime === "application/pdf" && bytes.subarray(0, 5).toString() === "%PDF-") ||
    (file.mime === "image/png" && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ||
    (file.mime === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255);
  if (!valid || bytes.length === 0 || bytes.length > 5 * 1024 * 1024 || !file.name.trim() || file.name.length > 255 || /[\r\n\x00/\\]/.test(file.name))
    throw new ApplicationError("VALIDATION_ERROR", { publicMessage: "แนบเฉพาะ PDF, PNG หรือ JPEG ไม่เกิน 5 MB และใช้ชื่อไฟล์ที่ถูกต้อง" });
  return file.mime === "application/pdf" ? "pdf" : file.mime === "image/png" ? "png" : "jpg";
};
export const createAttachmentService = (dependencies: {
  rootExecutor: DatabaseExecutor; transactionRunner: TransactionRunner; actions: ActionObserver; domain: DomainAuditObserver;
  employees: Pick<ReturnType<typeof createEmployeeService>, "getEmployee">;
  leave: Pick<ReturnType<typeof createLeaveRuntimeService>, "getHistory">;
  storage?: DocumentStorage;
}) => {
  const authorize = async (actor: AuthenticatedActor, owner: AttachmentOwner, requestId: string) => {
    databaseId(owner.id);
    if (owner.kind === "employee") await dependencies.employees.getEmployee({ actor, employeeId: owner.id, requestId });
    else await dependencies.leave.getHistory(operationActor(actor, requestId), databaseId(owner.id));
  };
  const ownerOf = (row: AttachmentRecord): AttachmentOwner => row.employeeId !== null
    ? { kind: "employee", id: String(row.employeeId) } : { kind: "leave", id: String(row.leaveRequestId) };
  return {
    async list(actor: AuthenticatedActor, owner: AttachmentOwner, requestId: string) {
      const context = createActionContext({ actor, requestId, actionBase: "attachment.file.list", target: { tableName: "attachments", recordId: "collection" } });
      return dependencies.actions.observeRead(context, async () => { await authorize(actor, owner, requestId); return attachmentRepository.list(dependencies.rootExecutor, owner); });
    },
    async upload(actor: AuthenticatedActor, owner: AttachmentOwner, file: { name: string; mime: string; bytes: Uint8Array }, requestId: string) {
      const context = createActionContext({ actor, requestId, actionBase: "attachment.file.upload", target: { tableName: "attachments", recordId: "unknown" } });
      return dependencies.actions.observeMutation(context, () => dependencies.transactionRunner.transaction(async (executor) => {
        await authorize(actor, owner, requestId);
        const extension = validateAttachment(file), storageKey = `attachments/${randomUUID()}.${extension}`;
        const stored = await (dependencies.storage ?? createDocumentStorage()).put(storageKey, file.bytes);
        const record = await attachmentRepository.insert(executor, { employeeId: owner.kind === "employee" ? databaseId(owner.id) : null,
          leaveRequestId: owner.kind === "leave" ? databaseId(owner.id) : null, fileName: file.name, mimeType: file.mime,
          storageKey, fileSizeBytes: stored.size, fileSha256: stored.sha256, uploadedByUserAccountId: databaseId(actor.accountId),
        });
        const receipt = await dependencies.domain.record(executor, createActionContext({ ...context, target: { tableName: "attachments", recordId: String(record.id) } }),
          { newData: { employee_id: record.employeeId, leave_request_id: record.leaveRequestId, mime_type: record.mimeType, size: record.fileSizeBytes, sha256: record.fileSha256 } });
        return dependencies.domain.complete(record, receipt);
      }));
    },
    async download(actor: AuthenticatedActor, id: string, requestId: string) {
      const context = createActionContext({ actor, requestId, actionBase: "attachment.file.download", target: { tableName: "attachments", recordId: id } });
      return dependencies.actions.observeRead(context, async () => {
        const record = await attachmentRepository.find(dependencies.rootExecutor, id);
        if (!record) throw new ApplicationError("RESOURCE_NOT_FOUND");
        await authorize(actor, ownerOf(record), requestId);
        const bytes = await (dependencies.storage ?? createDocumentStorage()).read(record.storageKey, record.fileSha256);
        if (bytes.length !== record.fileSizeBytes) throw new ApplicationError("STATE_CONFLICT");
        return { bytes, filename: record.fileName, mime: record.mimeType };
      });
    },
  };
};
export type AttachmentService = ReturnType<typeof createAttachmentService>;
