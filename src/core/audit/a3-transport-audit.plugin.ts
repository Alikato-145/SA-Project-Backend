import Elysia from "elysia";
import { createActionContext, resolveRequestId } from "./action-context";
import { wasFailureAudited, type ActionObserver } from "./action-observer";
import { requestIdPlugin } from "./request-id.plugin";

export interface RegisteredA3Action {
  method: string;
  pattern: RegExp;
  actionBase: string;
  tableName: string;
  recordId(match: RegExpMatchArray): string;
}

const sentinel = (value: string) => () => value;
const capturedId = (index: number) => (match: RegExpMatchArray) => {
  const candidate = match[index];
  return candidate &&
    /^[1-9]\d*$/.test(candidate) &&
    Number.isSafeInteger(Number(candidate))
    ? candidate
    : "unknown";
};

/** Public A3 actions only. Domain services own successful read/mutation outcomes. */
export const A3_ACTION_REGISTRY: readonly RegisteredA3Action[] = [
  {
    method: "GET",
    pattern: /^\/api\/v1\/employees\/?$/,
    actionBase: "employee.profile.list",
    tableName: "employees",
    recordId: sentinel("collection"),
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/employees\/?$/,
    actionBase: "employee.profile.create",
    tableName: "employees",
    recordId: sentinel("unknown"),
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/employees\/([^/]+)\/?$/,
    actionBase: "employee.profile.read",
    tableName: "employees",
    recordId: capturedId(1),
  },
  {
    method: "PATCH",
    pattern: /^\/api\/v1\/employees\/([^/]+)\/?$/,
    actionBase: "employee.profile.update",
    tableName: "employees",
    recordId: capturedId(1),
  },
  {
    method: "PATCH",
    pattern: /^\/api\/v1\/employees\/([^/]+)\/status\/?$/,
    actionBase: "employee.status.change",
    tableName: "employees",
    recordId: capturedId(1),
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/employees\/onboard\/?$/,
    actionBase: "employee.profile.onboard",
    tableName: "employees",
    recordId: sentinel("unknown"),
  },

  {
    method: "GET",
    pattern: /^\/api\/v1\/employees\/([^/]+)\/assignments\/?$/,
    actionBase: "employee.assignment.list",
    tableName: "employment_assignments",
    recordId: capturedId(1),
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/employees\/([^/]+)\/assignments\/?$/,
    actionBase: "employee.assignment.create",
    tableName: "employment_assignments",
    recordId: capturedId(1),
  },

  {
    method: "GET",
    pattern: /^\/api\/v1\/employees\/([^/]+)\/bank-accounts\/?$/,
    actionBase: "employee.bank.list",
    tableName: "employee_bank_accounts",
    recordId: capturedId(1),
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/employees\/([^/]+)\/bank-accounts\/?$/,
    actionBase: "employee.bank.create",
    tableName: "employee_bank_accounts",
    recordId: capturedId(1),
  },
  {
    method: "PATCH",
    pattern: /^\/api\/v1\/employees\/[^/]+\/bank-accounts\/([^/]+)\/?$/,
    actionBase: "employee.bank.update",
    tableName: "employee_bank_accounts",
    recordId: capturedId(1),
  },
  {
    method: "POST",
    pattern:
      /^\/api\/v1\/employees\/[^/]+\/bank-accounts\/([^/]+)\/make-primary\/?$/,
    actionBase: "employee.bank.make-primary",
    tableName: "employee_bank_accounts",
    recordId: capturedId(1),
  },
  {
    method: "POST",
    pattern:
      /^\/api\/v1\/employees\/[^/]+\/bank-accounts\/([^/]+)\/deactivate\/?$/,
    actionBase: "employee.bank.deactivate",
    tableName: "employee_bank_accounts",
    recordId: capturedId(1),
  },

  {
    method: "GET",
    pattern: /^\/api\/v1\/employees\/([^/]+)\/weekly-holidays\/?$/,
    actionBase: "employee.holiday.list",
    tableName: "employee_weekly_holidays",
    recordId: capturedId(1),
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/employees\/([^/]+)\/weekly-holidays\/?$/,
    actionBase: "employee.holiday.create",
    tableName: "employee_weekly_holidays",
    recordId: capturedId(1),
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/employees\/[^/]+\/weekly-holidays\/([^/]+)\/end\/?$/,
    actionBase: "employee.holiday.end",
    tableName: "employee_weekly_holidays",
    recordId: capturedId(1),
  },
] as const;

export const resolveRegisteredA3Action = (request: Request) => {
  if (request.method === "OPTIONS") return null;
  const pathname = new URL(request.url).pathname;
  for (const registration of A3_ACTION_REGISTRY) {
    if (registration.method !== request.method) continue;
    const match = pathname.match(registration.pattern);
    if (match) return { registration, match };
  }
  return null;
};

/** Framework/auth/validation failures before a service can establish its audit boundary. */
export const observeA3TransportFailure = async (
  actions: ActionObserver,
  request: Request,
  requestId: string | undefined,
  error: unknown,
): Promise<void> => {
  if (wasFailureAudited(error)) return;
  const resolved = resolveRegisteredA3Action(request);
  if (!resolved) return;
  const { registration, match } = resolved;
  await actions.observeFailure(
    createActionContext({
      requestId: resolveRequestId(requestId),
      actionBase: registration.actionBase,
      target: {
        tableName: registration.tableName,
        recordId: registration.recordId(match),
      },
    }),
    error,
  );
};

/** Add once at the A3 composition boundary; it does not format HTTP responses. */
export const createA3TransportAuditPlugin = (actions: ActionObserver) =>
  new Elysia({ name: "a3-transport-failure-audit" })
    .use(requestIdPlugin)
    .onError({ as: "global" }, async ({ request, error, requestId }) => {
      await observeA3TransportFailure(actions, request, requestId, error);
    });
