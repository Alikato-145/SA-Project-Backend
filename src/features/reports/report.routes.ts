import Elysia, { t } from "elysia";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { requestIdPlugin } from "../../core/audit/request-id.plugin";
import { toPublicErrorResult } from "../../core/errors/error-boundary";
import type { ReportService } from "./report.service";
export const createReportRoutes = (options: { service: ReportService; authenticate(request: Request): Promise<AuthenticatedActor> }) => new Elysia({ name: "report-routes", prefix: "/api/v1/reports", normalize: false }).use(requestIdPlugin).derive(async ({ request }) => ({ actor: await options.authenticate(request) })).onError(({ error, requestId, set }) => { const result = toPublicErrorResult(error, requestId); set.status = result.status; return result.body; })
  .get("/bank-transfer.csv", async ({ actor, query, requestId }) => new Response(await options.service.bankTransfer(actor, query.period_id, requestId), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename=bank-transfer-${query.period_id}.csv` } }), { query: t.Object({ period_id: t.String({ pattern: "^[1-9][0-9]*$" }) }) })
  .get("/social-security.csv", async ({ actor, query, requestId }) => new Response(await options.service.socialSecurity(actor, query.period_id, requestId), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename=social-security-${query.period_id}.csv` } }), { query: t.Object({ period_id: t.String({ pattern: "^[1-9][0-9]*$" }) }) });
