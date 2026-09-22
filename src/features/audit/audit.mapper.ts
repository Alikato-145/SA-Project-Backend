import type { AuditLogListResponseDto, AuditLogDto } from "./audit.dto";
import type { AuditLogRecord } from "./audit.repository";
import type { QueryAuditLogsResult } from "./audit.service";

export const toAuditLogDto = (record: AuditLogRecord): AuditLogDto => ({
  id: String(record.id),
  actor_account_id:
    record.actorUserAccountId === null
      ? null
      : String(record.actorUserAccountId),
  action: record.action,
  table_name: record.tableName,
  record_id: record.recordId,
  old_data: record.oldData ?? null,
  new_data: record.newData ?? null,
  reason: record.reason ?? null,
  occurred_at: record.occurredAt.toISOString(),
  request_id: record.requestId ?? null,
});

export const toAuditLogListResponseDto = (
  result: QueryAuditLogsResult,
  requestId: string,
): AuditLogListResponseDto => ({
  data: result.records.map(toAuditLogDto),
  meta: {
    pagination: {
      page: result.page,
      page_size: result.pageSize,
      total: result.total,
      total_pages:
        result.total === 0 ? 0 : Math.ceil(result.total / result.pageSize),
    },
  },
  request_id: requestId,
});
