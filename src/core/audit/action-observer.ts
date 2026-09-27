import type { DatabaseExecutor } from "../db/transaction";
import type { ActionContext } from "./action-context";
import type { AuditEventWriter, AuditReceipt } from "../../features/audit/audit.repository";
import { isAuditedMutation, type AuditedMutation } from "./domain-audit-observer";

const failureAlreadyAudited = new WeakSet<object>();
const stableCodePattern = /^[A-Z][A-Z0-9_]*$/;

export interface AuditFallbackLogger {
  error(event: { message: string; requestId: string; action: string }): void;
}

const defaultFallbackLogger: AuditFallbackLogger = {
  error(event) {
    console.error(JSON.stringify(event));
  },
};

export const markFailureAsAudited = <T>(error: T): T => {
  if ((typeof error === "object" && error !== null) || typeof error === "function") {
    failureAlreadyAudited.add(error as object);
  }
  return error;
};

export const wasFailureAudited = (error: unknown): boolean =>
  ((typeof error === "object" && error !== null) || typeof error === "function")
    && failureAlreadyAudited.has(error as object);

const errorCode = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && stableCodePattern.test(code)) return code;
  }
  return "INTERNAL_ERROR";
};

export class ActionObserver {
  constructor(
    private readonly rootExecutor: DatabaseExecutor,
    private readonly writer: AuditEventWriter,
    private readonly fallbackLogger: AuditFallbackLogger = defaultFallbackLogger,
  ) {}

  private event(context: ActionContext, outcome: "succeeded" | "failed", reason?: string) {
    return {
      actorAccountId: context.actorAccountId,
      action: `${context.actionBase}.${outcome}`,
      tableName: context.target.tableName,
      recordId: context.target.recordId,
      reason: reason ?? null,
      requestId: context.requestId,
    };
  }

  private async persistFailure(context: ActionContext, originalError: unknown): Promise<void> {
    if (wasFailureAudited(originalError)) return;
    try {
      await this.writer.insert(this.rootExecutor, this.event(context, "failed", errorCode(originalError)));
      markFailureAsAudited(originalError);
    } catch {
      this.fallbackLogger.error({
        message: "Persistent audit unavailable",
        requestId: context.requestId,
        action: `${context.actionBase}.failed`,
      });
    }
  }

  /** Records failures that occur before a feature service can establish its observer. */
  async observeFailure(context: ActionContext, error: unknown): Promise<void> {
    await this.persistFailure(context, error);
  }

  async observeRead<T>(context: ActionContext, work: () => Promise<T>): Promise<T> {
    let value: T;
    try {
      value = await work();
    } catch (error) {
      await this.persistFailure(context, error);
      throw error;
    }

    // Audit before disclosure. An audit outage fails the read closed.
    await this.writer.insert(this.rootExecutor, this.event(context, "succeeded"));
    return value;
  }

  async observeMutation<T>(
    context: ActionContext,
    work: () => Promise<AuditedMutation<T>>,
  ): Promise<T> {
    try {
      const result = await work();
      if (!isAuditedMutation<T>(result) || result.receipt.requestId !== context.requestId) {
        throw new Error("Mutation completed without its canonical audit receipt");
      }
      return result.value;
    } catch (error) {
      await this.persistFailure(context, error);
      throw error;
    }
  }
}
