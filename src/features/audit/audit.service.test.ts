import { describe, expect, test } from "bun:test";
import type { DatabaseExecutor } from "../../core/db/transaction";
import type { AuthenticatedActor, RoleCode } from "../../core/auth/auth.types";
import { ApplicationError } from "../../core/errors/application.error";
import type {
  AuditEvent,
  AuditEventWriter,
  AuditQueryRepository,
} from "./audit.repository";
import { createAuditService } from "./audit.service";

const executor = {} as DatabaseExecutor;

const actor = (
  roleCode: RoleCode,
  scope: "all" | "branch" = "all",
): AuthenticatedActor => ({
  accountId: "9",
  employeeId: "4",
  username: "auditor",
  grants: [
    {
      grantId: "12",
      roleCode,
      scope,
      branchId: scope === "branch" ? "2" : null,
      departmentId: null,
    },
  ],
});

const setup = () => {
  const events: AuditEvent[] = [];
  let queryCount = 0;
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
      queryCount += 1;
      expect(input).toEqual({
        page: 2,
        pageSize: 10,
        filters: { tableName: "user_accounts" },
      });
      return { records: [], total: 11 };
    },
  };
  return {
    events,
    queryCount: () => queryCount,
    service: createAuditService(executor, writer, undefined, queryRepository),
  };
};

describe("audit query service", () => {
  for (const roleCode of ["HR", "OWNER"] as const) {
    test(`allows ${roleCode} with all scope and emits one non-recursive event`, async () => {
      const fixture = setup();
      const result = await fixture.service.queryAuditLogs({
        actor: actor(roleCode),
        requestId: `audit-query-${roleCode.toLowerCase()}`,
        page: 2,
        pageSize: 10,
        filters: { tableName: "user_accounts" },
      });

      expect(result.total).toBe(11);
      expect(fixture.queryCount()).toBe(1);
      expect(fixture.events).toHaveLength(1);
      expect(fixture.events[0]).toMatchObject({
        actorAccountId: "9",
        action: "audit.history.list.succeeded",
        tableName: "audit_logs",
        recordId: "collection",
      });
    });
  }

  test("rejects non-all and non-HR/Owner grants before reading and audits the failure", async () => {
    for (const denied of [
      actor("HR", "branch"),
      actor("BRANCH_MANAGER", "branch"),
    ]) {
      const fixture = setup();
      const error = await fixture.service
        .queryAuditLogs({
          actor: denied,
          requestId: "audit-query-denied",
          page: 2,
          pageSize: 10,
          filters: { tableName: "user_accounts" },
        })
        .catch((caught) => caught);

      expect(error).toBeInstanceOf(ApplicationError);
      expect(error.code).toBe("FORBIDDEN_SCOPE");
      expect(fixture.queryCount()).toBe(0);
      expect(fixture.events).toHaveLength(1);
      expect(fixture.events[0]).toMatchObject({
        action: "audit.history.list.failed",
        reason: "FORBIDDEN_SCOPE",
      });
    }
  });
});
