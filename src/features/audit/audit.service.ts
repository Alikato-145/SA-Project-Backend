import { db } from "../../core/db/client";
import {
  ActionObserver,
  type AuditFallbackLogger,
} from "../../core/audit/action-observer";
import { DomainAuditObserver } from "../../core/audit/domain-audit-observer";
import type { DatabaseExecutor } from "../../core/db/transaction";
import { createActionContext } from "../../core/audit/action-context";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { ApplicationError } from "../../core/errors/application.error";
import {
  auditRepository,
  type AuditEventWriter,
  type AuditLogRecord,
  type AuditQueryFilters,
  type AuditQueryRepository,
} from "./audit.repository";

export interface QueryAuditLogsCommand {
  actor: AuthenticatedActor;
  requestId: string;
  page: number;
  pageSize: number;
  filters: AuditQueryFilters;
}

export interface QueryAuditLogsResult {
  records: AuditLogRecord[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AuditService {
  actions: ActionObserver;
  domain: DomainAuditObserver;
  queryAuditLogs(command: QueryAuditLogsCommand): Promise<QueryAuditLogsResult>;
}

const canInspectAudit = (actor: AuthenticatedActor): boolean =>
  actor.grants.some(
    (grant) =>
      grant.scope === "all" &&
      (grant.roleCode === "HR" || grant.roleCode === "OWNER"),
  );

export const createAuditService = (
  rootExecutor: DatabaseExecutor = db,
  writer: AuditEventWriter = auditRepository,
  fallbackLogger?: AuditFallbackLogger,
  queryRepository: AuditQueryRepository = auditRepository,
): AuditService => {
  const actions = new ActionObserver(rootExecutor, writer, fallbackLogger);

  return {
    actions,
    domain: new DomainAuditObserver(writer),
    queryAuditLogs(command) {
      const context = createActionContext({
        requestId: command.requestId,
        actor: command.actor,
        actionBase: "audit.history.list",
        target: { tableName: "audit_logs", recordId: "collection" },
      });

      return actions.observeRead(context, async () => {
        if (!canInspectAudit(command.actor)) {
          throw new ApplicationError("FORBIDDEN_SCOPE");
        }

        const result = await queryRepository.findPage(rootExecutor, {
          page: command.page,
          pageSize: command.pageSize,
          filters: command.filters,
        });

        return {
          records: result.records,
          page: command.page,
          pageSize: command.pageSize,
          total: result.total,
        };
      });
    },
  };
};

export const auditService = createAuditService();
