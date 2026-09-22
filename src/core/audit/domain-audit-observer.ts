import type { DatabaseExecutor } from "../db/transaction";
import type { ActionContext } from "./action-context";
import type { AuditSnapshot } from "./audit-redaction";
import type { AuditEventWriter, AuditReceipt } from "../../features/audit/audit.repository";

const auditedMutation = Symbol("auditedMutation");

export interface AuditedMutation<T> {
  readonly value: T;
  readonly receipt: AuditReceipt;
  readonly [auditedMutation]: true;
}

export class DomainAuditObserver {
  constructor(private readonly writer: AuditEventWriter) {}

  record(
    executor: DatabaseExecutor,
    context: ActionContext,
    facts: { oldData?: AuditSnapshot | null; newData?: AuditSnapshot | null; reason?: string | null; outcome?: "succeeded" | "failed" },
  ): Promise<AuditReceipt> {
    return this.writer.insert(executor, {
      actorAccountId: context.actorAccountId,
      action: `${context.actionBase}.${facts.outcome ?? "succeeded"}`,
      tableName: context.target.tableName,
      recordId: context.target.recordId,
      oldData: facts.oldData,
      newData: facts.newData,
      reason: facts.reason,
      requestId: context.requestId,
    });
  }

  complete<T>(value: T, receipt: AuditReceipt): AuditedMutation<T> {
    return { value, receipt, [auditedMutation]: true };
  }
}

export const isAuditedMutation = <T>(value: unknown): value is AuditedMutation<T> =>
  typeof value === "object" && value !== null && auditedMutation in value;

