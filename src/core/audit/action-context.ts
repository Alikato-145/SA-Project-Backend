import type { AuthenticatedActor } from "../auth/auth.types";

export const REQUEST_ID_HEADER = "x-request-id" as const;
export const AUDIT_TARGET_SENTINELS = ["unknown", "self", "collection"] as const;

const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const actionBasePattern = /^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*$/;
const tableNamePattern = /^[a-z][a-z0-9_]{0,99}$/;
const recordIdPattern = /^(?:[1-9][0-9]*|unknown|self|collection)$/;

export interface AuditTarget {
  tableName: string;
  recordId: string;
}

export interface ActionContext {
  requestId: string;
  actorAccountId: string | null;
  actionBase: string;
  target: AuditTarget;
}

export const isValidRequestId = (value: string): boolean => requestIdPattern.test(value);

export const resolveRequestId = (
  supplied: string | null | undefined,
  generate: () => string = crypto.randomUUID,
): string => (supplied && isValidRequestId(supplied) ? supplied : generate());

export const createActionContext = (input: {
  requestId: string;
  actor?: Pick<AuthenticatedActor, "accountId"> | null;
  actorAccountId?: string | null;
  actionBase: string;
  target: AuditTarget;
}): ActionContext => {
  if (!isValidRequestId(input.requestId)) throw new Error("Invalid audit request ID");
  if (!actionBasePattern.test(input.actionBase) || input.actionBase.length > 70) {
    throw new Error("Invalid audit action base");
  }
  if (!tableNamePattern.test(input.target.tableName)) throw new Error("Invalid audit table name");
  if (!recordIdPattern.test(input.target.recordId) || input.target.recordId.length > 100) {
    throw new Error("Invalid audit record ID");
  }

  return Object.freeze({
    requestId: input.requestId,
    actorAccountId: input.actorAccountId ?? input.actor?.accountId ?? null,
    actionBase: input.actionBase,
    target: Object.freeze({ ...input.target }),
  });
};

