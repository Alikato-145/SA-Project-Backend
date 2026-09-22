import Elysia from "elysia";
import { createActionContext, resolveRequestId } from "./action-context";
import { requestIdPlugin } from "./request-id.plugin";
import { wasFailureAudited, type ActionObserver } from "./action-observer";

export interface RegisteredA1Action {
  method: string;
  pattern: RegExp;
  actionBase: string;
  tableName: string;
  recordId(match: RegExpMatchArray): string;
}

const sentinel = (value: string) => () => value;
const capturedId = (index: number) => (match: RegExpMatchArray) => match[index] ?? "unknown";

export const A1_ACTION_REGISTRY: readonly RegisteredA1Action[] = [
  { method: "POST", pattern: /^\/api\/v1\/auth\/login\/?$/, actionBase: "authentication.session.login", tableName: "user_accounts", recordId: sentinel("unknown") },
  { method: "POST", pattern: /^\/api\/v1\/auth\/logout\/?$/, actionBase: "authentication.session.logout", tableName: "user_accounts", recordId: sentinel("self") },
  { method: "GET", pattern: /^\/api\/v1\/auth\/me\/?$/, actionBase: "authentication.session.view", tableName: "user_accounts", recordId: sentinel("self") },
  { method: "GET", pattern: /^\/api\/v1\/accounts\/?$/, actionBase: "account.catalog.list", tableName: "user_accounts", recordId: sentinel("collection") },
  { method: "POST", pattern: /^\/api\/v1\/accounts\/?$/, actionBase: "account.profile.create", tableName: "user_accounts", recordId: sentinel("unknown") },
  { method: "GET", pattern: /^\/api\/v1\/accounts\/([1-9]\d*)\/?$/, actionBase: "account.profile.read", tableName: "user_accounts", recordId: capturedId(1) },
  { method: "PATCH", pattern: /^\/api\/v1\/accounts\/([1-9]\d*)\/status\/?$/, actionBase: "account.status.change", tableName: "user_accounts", recordId: capturedId(1) },
  { method: "POST", pattern: /^\/api\/v1\/accounts\/([1-9]\d*)\/reset-password\/?$/, actionBase: "account.credential.reset", tableName: "user_accounts", recordId: capturedId(1) },
  { method: "POST", pattern: /^\/api\/v1\/accounts\/([1-9]\d*)\/unlock\/?$/, actionBase: "account.lock.unlock", tableName: "user_accounts", recordId: capturedId(1) },
  { method: "GET", pattern: /^\/api\/v1\/roles\/?$/, actionBase: "role.catalog.read", tableName: "roles", recordId: sentinel("collection") },
  { method: "POST", pattern: /^\/api\/v1\/accounts\/([1-9]\d*)\/roles\/?$/, actionBase: "role.grant.create", tableName: "user_account_roles", recordId: capturedId(1) },
  { method: "DELETE", pattern: /^\/api\/v1\/accounts\/[1-9]\d*\/roles\/([1-9]\d*)\/?$/, actionBase: "role.grant.revoke", tableName: "user_account_roles", recordId: capturedId(1) },
  { method: "GET", pattern: /^\/api\/v1\/audit-logs\/?$/, actionBase: "audit.history.list", tableName: "audit_logs", recordId: sentinel("collection") },
] as const;

export const resolveRegisteredA1Action = (request: Request) => {
  if (request.method === "OPTIONS") return null;
  const pathname = new URL(request.url).pathname;
  for (const registration of A1_ACTION_REGISTRY) {
    if (registration.method !== request.method) continue;
    const match = pathname.match(registration.pattern);
    if (match) return { registration, match };
  }
  return null;
};

export const observeA1TransportFailure = async (
  actions: ActionObserver,
  request: Request,
  requestId: string | undefined,
  error: unknown,
): Promise<void> => {
  if (wasFailureAudited(error)) return;
  const resolved = resolveRegisteredA1Action(request);
  if (!resolved) return;
  const { registration, match } = resolved;
  await actions.observeFailure(createActionContext({
    requestId: resolveRequestId(requestId),
    actionBase: registration.actionBase,
    target: { tableName: registration.tableName, recordId: registration.recordId(match) },
  }), error);
};

/** Add once at the A1 composition boundary; it does not format HTTP responses. */
export const createA1TransportAuditPlugin = (actions: ActionObserver) =>
  new Elysia({ name: "a1-transport-failure-audit" })
    .use(requestIdPlugin)
    .onError({ as: "global" }, async ({ request, error, requestId }) => {
      await observeA1TransportFailure(actions, request, requestId, error);
    });
