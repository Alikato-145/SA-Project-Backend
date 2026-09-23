import Elysia from "elysia";
import { createA3TransportAuditPlugin } from "../../core/audit/a3-transport-audit.plugin";
import type { ActionObserver } from "../../core/audit/action-observer";
import type { AuthenticatedActor, RoleCode } from "../../core/auth/auth.types";
import type { EmployeeService } from "./employee.service";
import { createEmployeeRoutes } from "./employee.routes";

/** Test-only actors, deliberately separate from production authentication. */
export const employeeTestActor = (role: RoleCode): AuthenticatedActor => {
  const scope = role === "OWNER" || role === "HR" ? "all"
    : role === "BRANCH_MANAGER" ? "branch"
      : role === "SUPERVISOR" ? "department" : "self";
  return {
    accountId: "90", employeeId: role === "EMPLOYEE" ? "1" : null,
    username: role.toLowerCase(),
    grants: [{
      grantId: "90", roleCode: role, scope,
      branchId: scope === "branch" || scope === "department" ? "10" : null,
      departmentId: scope === "department" ? "100" : null,
    }],
  };
};

export const createEmployeeReadTestApp = (options: {
  service: EmployeeService;
  actions: ActionObserver;
  authenticate(request: Request): Promise<AuthenticatedActor>;
}) => new Elysia()
  .use(createA3TransportAuditPlugin(options.actions))
  .use(createEmployeeRoutes({
    service: options.service, authenticate: options.authenticate,
    allowedOrigins: ["http://localhost"],
  }));
