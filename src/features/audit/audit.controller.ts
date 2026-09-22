import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { ApplicationError } from "../../core/errors/application.error";
import type { AuditLogQueryDto } from "./audit.dto";
import { toAuditLogListResponseDto } from "./audit.mapper";
import type { AuditQueryFilters } from "./audit.repository";
import type { AuditService } from "./audit.service";

const decimalIdPattern = /^[1-9][0-9]*$/;
const stableTokenPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

const invalid = (field: string): never => {
  throw new ApplicationError("VALIDATION_ERROR", {
    fieldErrors: { [field]: ["Invalid value."] },
  });
};

const positiveInteger = (
  value: string | number | undefined,
  fallback: number,
  maximum: number,
  field: string,
): number => {
  if (value === undefined) return fallback;
  const text = String(value);
  if (!decimalIdPattern.test(text)) return invalid(field);
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) return invalid(field);
  return parsed;
};

const limitedToken = (
  value: string | undefined,
  maximum: number,
  field: string,
): string | undefined => {
  if (value === undefined) return undefined;
  if (
    value.length < 1 ||
    value.length > maximum ||
    !stableTokenPattern.test(value)
  ) {
    return invalid(field);
  }
  return value;
};

const dateTime = (
  value: string | undefined,
  field: string,
): Date | undefined => {
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || !value.includes("T"))
    return invalid(field);
  return parsed;
};

const actorAccountId = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  if (!decimalIdPattern.test(value)) return invalid("actor_account_id");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return invalid("actor_account_id");
  return parsed;
};

const parseQuery = (
  query: AuditLogQueryDto,
): {
  page: number;
  pageSize: number;
  filters: AuditQueryFilters;
} => {
  const occurredFrom = dateTime(query.occurred_from, "occurred_from");
  const occurredTo = dateTime(query.occurred_to, "occurred_to");
  if (occurredFrom && occurredTo && occurredFrom > occurredTo) {
    return invalid("occurred_to");
  }

  return {
    page: positiveInteger(query.page, 1, 1_000_000, "page"),
    pageSize: positiveInteger(query.page_size, 20, 100, "page_size"),
    filters: {
      action: limitedToken(query.action, 80, "action"),
      actorAccountId: actorAccountId(query.actor_account_id),
      tableName: limitedToken(query.table_name, 100, "table_name"),
      recordId: limitedToken(query.record_id, 100, "record_id"),
      requestId: limitedToken(query.request_id, 100, "request_id"),
      occurredFrom,
      occurredTo,
    },
  };
};

export const createAuditController = (service: AuditService) => ({
  async list(input: {
    actor: AuthenticatedActor;
    requestId: string;
    query: AuditLogQueryDto;
  }) {
    const parsed = parseQuery(input.query);
    const result = await service.queryAuditLogs({
      actor: input.actor,
      requestId: input.requestId,
      ...parsed,
    });
    return toAuditLogListResponseDto(result, input.requestId);
  },
});

export type AuditController = ReturnType<typeof createAuditController>;
