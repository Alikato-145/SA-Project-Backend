import Elysia from "elysia";
import { createActionContext, resolveRequestId } from "./action-context";
import { requestIdPlugin } from "./request-id.plugin";
import { wasFailureAudited, type ActionObserver } from "./action-observer";

export interface RegisteredA2Action {
  method: string;
  pattern: RegExp;
  actionBase: string;
  tableName: string;
  recordId(match: RegExpMatchArray): string;
}

const sentinel = (value: string) => () => value;
const capturedId = (index: number) => (match: RegExpMatchArray) => match[index] ?? "unknown";

export const A2_ACTION_REGISTRY: readonly RegisteredA2Action[] = [
  { method: "GET", pattern: /^\/api\/v1\/shops\/?$/, actionBase: "organization.shop.list", tableName: "shops", recordId: sentinel("collection") },
  { method: "POST", pattern: /^\/api\/v1\/shops\/?$/, actionBase: "organization.shop.create", tableName: "shops", recordId: sentinel("unknown") },
  { method: "GET", pattern: /^\/api\/v1\/shops\/([1-9]\d*)\/?$/, actionBase: "organization.shop.read", tableName: "shops", recordId: capturedId(1) },
  { method: "PATCH", pattern: /^\/api\/v1\/shops\/([1-9]\d*)\/?$/, actionBase: "organization.shop.update", tableName: "shops", recordId: capturedId(1) },
  { method: "POST", pattern: /^\/api\/v1\/shops\/([1-9]\d*)\/deactivate\/?$/, actionBase: "organization.shop.deactivate", tableName: "shops", recordId: capturedId(1) },

  { method: "GET", pattern: /^\/api\/v1\/branches\/?$/, actionBase: "organization.branch.list", tableName: "branches", recordId: sentinel("collection") },
  { method: "POST", pattern: /^\/api\/v1\/branches\/?$/, actionBase: "organization.branch.create", tableName: "branches", recordId: sentinel("unknown") },
  { method: "GET", pattern: /^\/api\/v1\/branches\/([1-9]\d*)\/?$/, actionBase: "organization.branch.read", tableName: "branches", recordId: capturedId(1) },
  { method: "PATCH", pattern: /^\/api\/v1\/branches\/([1-9]\d*)\/?$/, actionBase: "organization.branch.update", tableName: "branches", recordId: capturedId(1) },
  { method: "POST", pattern: /^\/api\/v1\/branches\/([1-9]\d*)\/deactivate\/?$/, actionBase: "organization.branch.deactivate", tableName: "branches", recordId: capturedId(1) },

  { method: "GET", pattern: /^\/api\/v1\/departments\/?$/, actionBase: "organization.department.list", tableName: "departments", recordId: sentinel("collection") },
  { method: "POST", pattern: /^\/api\/v1\/departments\/?$/, actionBase: "organization.department.create", tableName: "departments", recordId: sentinel("unknown") },
  { method: "GET", pattern: /^\/api\/v1\/departments\/([1-9]\d*)\/?$/, actionBase: "organization.department.read", tableName: "departments", recordId: capturedId(1) },
  { method: "PATCH", pattern: /^\/api\/v1\/departments\/([1-9]\d*)\/?$/, actionBase: "organization.department.update", tableName: "departments", recordId: capturedId(1) },
  { method: "POST", pattern: /^\/api\/v1\/departments\/([1-9]\d*)\/deactivate\/?$/, actionBase: "organization.department.deactivate", tableName: "departments", recordId: capturedId(1) },

  { method: "GET", pattern: /^\/api\/v1\/positions\/?$/, actionBase: "organization.position.list", tableName: "positions", recordId: sentinel("collection") },
  { method: "POST", pattern: /^\/api\/v1\/positions\/?$/, actionBase: "organization.position.create", tableName: "positions", recordId: sentinel("unknown") },
  { method: "GET", pattern: /^\/api\/v1\/positions\/([1-9]\d*)\/?$/, actionBase: "organization.position.read", tableName: "positions", recordId: capturedId(1) },
  { method: "PATCH", pattern: /^\/api\/v1\/positions\/([1-9]\d*)\/?$/, actionBase: "organization.position.update", tableName: "positions", recordId: capturedId(1) },
  { method: "POST", pattern: /^\/api\/v1\/positions\/([1-9]\d*)\/deactivate\/?$/, actionBase: "organization.position.deactivate", tableName: "positions", recordId: capturedId(1) },
] as const;

export const resolveRegisteredA2Action = (request: Request) => {
  if (request.method === "OPTIONS") return null;
  const pathname = new URL(request.url).pathname;
  for (const registration of A2_ACTION_REGISTRY) {
    if (registration.method !== request.method) continue;
    const match = pathname.match(registration.pattern);
    if (match) return { registration, match };
  }
  return null;
};

export const observeA2TransportFailure = async (
  actions: ActionObserver,
  request: Request,
  requestId: string | undefined,
  error: unknown,
): Promise<void> => {
  if (wasFailureAudited(error)) return;
  const resolved = resolveRegisteredA2Action(request);
  if (!resolved) return;
  const { registration, match } = resolved;
  await actions.observeFailure(createActionContext({
    requestId: resolveRequestId(requestId),
    actionBase: registration.actionBase,
    target: {
      tableName: registration.tableName,
      recordId: registration.recordId(match),
    },
  }), error);
};

/** Add once at the A2 composition boundary; it does not format HTTP responses. */
export const createA2TransportAuditPlugin = (actions: ActionObserver) =>
  new Elysia({ name: "a2-transport-failure-audit" })
    .use(requestIdPlugin)
    .onError({ as: "global" }, async ({ request, error, requestId }) => {
      await observeA2TransportFailure(actions, request, requestId, error);
    });
