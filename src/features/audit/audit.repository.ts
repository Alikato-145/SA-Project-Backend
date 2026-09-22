import { and, count, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import type { DatabaseExecutor } from "../../core/db/transaction";
import {
  redactAuditSnapshot,
  type AuditSnapshot,
} from "../../core/audit/audit-redaction";
import { auditLogs } from "./audit.schema";

const finalActionPattern =
  /^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*\.(?:succeeded|failed)$/;
const stableReasonPattern = /^[A-Z][A-Z0-9_]*$/;

export interface AuditEvent {
  actorAccountId: string | null;
  action: string;
  tableName: string;
  recordId: string;
  oldData?: AuditSnapshot | null;
  newData?: AuditSnapshot | null;
  reason?: string | null;
  requestId: string;
}

export interface AuditReceipt {
  id: number;
  action: string;
  requestId: string;
}

export interface AuditEventWriter {
  insert(executor: DatabaseExecutor, event: AuditEvent): Promise<AuditReceipt>;
}

export interface AuditQueryFilters {
  action?: string;
  actorAccountId?: number;
  tableName?: string;
  recordId?: string;
  requestId?: string;
  occurredFrom?: Date;
  occurredTo?: Date;
}

export interface AuditQueryInput {
  page: number;
  pageSize: number;
  filters: AuditQueryFilters;
}

export type AuditLogRecord = typeof auditLogs.$inferSelect;

export interface AuditQueryResult {
  records: AuditLogRecord[];
  total: number;
}

export interface AuditQueryRepository {
  findPage(
    executor: DatabaseExecutor,
    input: AuditQueryInput,
  ): Promise<AuditQueryResult>;
}

const queryConditions = (filters: AuditQueryFilters): SQL[] => {
  const conditions: SQL[] = [];
  if (filters.action !== undefined)
    conditions.push(eq(auditLogs.action, filters.action));
  if (filters.actorAccountId !== undefined) {
    conditions.push(eq(auditLogs.actorUserAccountId, filters.actorAccountId));
  }
  if (filters.tableName !== undefined)
    conditions.push(eq(auditLogs.tableName, filters.tableName));
  if (filters.recordId !== undefined)
    conditions.push(eq(auditLogs.recordId, filters.recordId));
  if (filters.requestId !== undefined)
    conditions.push(eq(auditLogs.requestId, filters.requestId));
  if (filters.occurredFrom !== undefined)
    conditions.push(gte(auditLogs.occurredAt, filters.occurredFrom));
  if (filters.occurredTo !== undefined)
    conditions.push(lte(auditLogs.occurredAt, filters.occurredTo));
  return conditions;
};

const databaseId = (value: string | null): number | null => {
  if (value === null) return null;
  if (!/^[1-9][0-9]*$/.test(value))
    throw new Error("Invalid audit actor account ID");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed))
    throw new Error(
      "Audit actor account ID exceeds the supported database range",
    );
  return parsed;
};

const validateEvent = (event: AuditEvent): void => {
  if (!finalActionPattern.test(event.action) || event.action.length > 80)
    throw new Error("Invalid audit action");
  if (event.tableName.length < 1 || event.tableName.length > 100)
    throw new Error("Invalid audit table name");
  if (event.recordId.length < 1 || event.recordId.length > 100)
    throw new Error("Invalid audit record ID");
  if (event.requestId.length < 1 || event.requestId.length > 100)
    throw new Error("Invalid audit request ID");
  if (
    event.reason !== undefined &&
    event.reason !== null &&
    !stableReasonPattern.test(event.reason)
  ) {
    throw new Error("Audit reason must be a stable public code");
  }
};

export const auditRepository: AuditEventWriter &
  AuditQueryRepository & {
    findByRequestId(
      executor: DatabaseExecutor,
      requestId: string,
    ): Promise<(typeof auditLogs.$inferSelect)[]>;
  } = {
  async insert(executor, event) {
    validateEvent(event);
    const [inserted] = await executor
      .insert(auditLogs)
      .values({
        actorUserAccountId: databaseId(event.actorAccountId),
        action: event.action,
        tableName: event.tableName,
        recordId: event.recordId,
        oldData: event.oldData ? redactAuditSnapshot(event.oldData) : null,
        newData: event.newData ? redactAuditSnapshot(event.newData) : null,
        reason: event.reason ?? null,
        requestId: event.requestId,
      })
      .returning({
        id: auditLogs.id,
        action: auditLogs.action,
        requestId: auditLogs.requestId,
      });

    if (!inserted) throw new Error("Audit insert did not return a receipt");
    return {
      id: inserted.id,
      action: inserted.action,
      requestId: inserted.requestId ?? event.requestId,
    };
  },

  async findByRequestId(executor, requestId) {
    return executor
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.requestId, requestId)))
      .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id));
  },

  async findPage(executor, input) {
    const conditions = queryConditions(input.filters);
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (input.page - 1) * input.pageSize;

    const [records, totals] = await Promise.all([
      executor
        .select()
        .from(auditLogs)
        .where(where)
        .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
        .limit(input.pageSize)
        .offset(offset),
      executor.select({ value: count() }).from(auditLogs).where(where),
    ]);

    return { records, total: totals[0]?.value ?? 0 };
  },
};
