import type { AuditSnapshot } from "../../core/audit/audit-redaction";
import type { SuccessHttpDto } from "../../shared/http/http.dto";

export interface AuditLogDto {
  id: string;
  actor_account_id: string | null;
  action: string;
  table_name: string;
  record_id: string;
  old_data: AuditSnapshot | null;
  new_data: AuditSnapshot | null;
  reason: string | null;
  occurred_at: string;
  request_id: string | null;
}

export interface AuditPaginationDto {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export type AuditLogListResponseDto = SuccessHttpDto<
  AuditLogDto[],
  { pagination: AuditPaginationDto }
>;

export interface AuditLogQueryDto {
  page?: string | number;
  page_size?: string | number;
  action?: string;
  actor_account_id?: string;
  table_name?: string;
  record_id?: string;
  request_id?: string;
  occurred_from?: string;
  occurred_to?: string;
}
