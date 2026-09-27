import { describe, expect, test } from "bun:test";
import type { DatabaseExecutor } from "../../core/db/transaction";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type {
  AuditEvent,
  AuditEventWriter,
  AuditQueryInput,
  AuditQueryRepository,
} from "./audit.repository";
import { createAuditRoutes } from "./audit.routes";
import { createAuditService } from "./audit.service";

const executor = {} as DatabaseExecutor;
const owner: AuthenticatedActor = {
  accountId: "8",
  employeeId: null,
  username: "owner",
  grants: [
    {
      grantId: "3",
      roleCode: "OWNER",
      scope: "all",
      branchId: null,
      departmentId: null,
    },
  ],
};

const setup = (authenticatedActor: AuthenticatedActor = owner) => {
  const events: AuditEvent[] = [];
  const queries: AuditQueryInput[] = [];
  const writer: AuditEventWriter = {
    async insert(_executor, event) {
      events.push(event);
      return {
        id: events.length,
        action: event.action,
        requestId: event.requestId,
      };
    },
  };
  const queryRepository: AuditQueryRepository = {
    async findPage(_executor, input) {
      queries.push(input);
      return {
        records: [
          {
            id: 900719,
            actorUserAccountId: 8,
            action: "auth.session.login.succeeded",
            tableName: "user_accounts",
            recordId: "8",
            oldData: null,
            newData: { status: "active" },
            reason: null,
            occurredAt: new Date("2026-09-22T01:02:03.000Z"),
            requestId: "login-request-1",
          },
        ],
        total: 21,
      };
    },
  };
  const service = createAuditService(
    executor,
    writer,
    undefined,
    queryRepository,
  );
  const app = createAuditRoutes({
    service,
    authenticate: async () => authenticatedActor,
  });
  return { app, events, queries };
};

describe("GET /api/v1/audit-logs", () => {
  test("returns snake_case DTOs, decimal string IDs, filters, and stable pagination", async () => {
    const fixture = setup();
    const response = await fixture.app.handle(
      new Request(
        "http://localhost/api/v1/audit-logs/?page=2&page_size=10&action=auth.session.login.succeeded&actor_account_id=8&table_name=user_accounts&record_id=8&request_id=login-request-1&occurred_from=2026-09-01T00%3A00%3A00.000Z&occurred_to=2026-09-30T23%3A59%3A59.000Z",
        { headers: { "x-request-id": "audit-list-request" } },
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [
        {
          id: "900719",
          actor_account_id: "8",
          action: "auth.session.login.succeeded",
          table_name: "user_accounts",
          record_id: "8",
          old_data: null,
          new_data: { status: "active" },
          reason: null,
          occurred_at: "2026-09-22T01:02:03.000Z",
          request_id: "login-request-1",
        },
      ],
      meta: {
        pagination: { page: 2, page_size: 10, total: 21, total_pages: 3 },
      },
      request_id: "audit-list-request",
    });
    expect(fixture.queries).toHaveLength(1);
    expect(fixture.queries[0]).toMatchObject({
      page: 2,
      pageSize: 10,
      filters: {
        action: "auth.session.login.succeeded",
        actorAccountId: 8,
        tableName: "user_accounts",
        recordId: "8",
        requestId: "login-request-1",
      },
    });
    expect(fixture.queries[0]?.filters.occurredFrom?.toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
    expect(fixture.queries[0]?.filters.occurredTo?.toISOString()).toBe(
      "2026-09-30T23:59:59.000Z",
    );
    expect(fixture.events).toHaveLength(1);
  });

  test("returns stable 422 for invalid pagination without querying", async () => {
    const fixture = setup();
    const response = await fixture.app.handle(
      new Request("http://localhost/api/v1/audit-logs/?page=0&page_size=101", {
        headers: { "x-request-id": "audit-invalid-query" },
      }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
      request_id: "audit-invalid-query",
    });
    expect(fixture.queries).toHaveLength(0);
  });

  test("returns forbidden for a branch-scoped manager and records one failed event", async () => {
    const fixture = setup({
      ...owner,
      grants: [
        {
          grantId: "5",
          roleCode: "BRANCH_MANAGER",
          scope: "branch",
          branchId: "2",
          departmentId: null,
        },
      ],
    });
    const response = await fixture.app.handle(
      new Request("http://localhost/api/v1/audit-logs/", {
        headers: { "x-request-id": "audit-forbidden" },
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "FORBIDDEN_SCOPE" },
      request_id: "audit-forbidden",
    });
    expect(fixture.queries).toHaveLength(0);
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0]?.action).toBe("audit.history.list.failed");
  });
});
