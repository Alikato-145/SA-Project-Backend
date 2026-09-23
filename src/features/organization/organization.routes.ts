import Elysia from "elysia";
import { createA2TransportAuditPlugin } from "../../core/audit/a2-transport-audit.plugin";
import type { ActionObserver } from "../../core/audit/action-observer";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { createBranchRoutes } from "../branch/branch.routes";
import type { BranchService } from "../branch/branch.service";
import { createDepartmentRoutes } from "../department/department.routes";
import type { DepartmentService } from "../department/department.service";
import { createPositionRoutes } from "../position/position.routes";
import type { PositionService } from "../position/position.service";
import { createShopRoutes } from "../shop/shop.routes";
import type { ShopService } from "../shop/shop.service";

export interface OrganizationRoutesOptions {
  actions: ActionObserver;
  services: {
    shops: ShopService;
    branches: BranchService;
    departments: DepartmentService;
    positions: PositionService;
  };
  authenticate(request: Request): Promise<AuthenticatedActor>;
  allowedOrigins: readonly string[];
}

/**
 * Dependency-injected A2 composition boundary.
 *
 * The shared application root can register this bundle when Person C composes
 * the feature. Keeping the transport observer here guarantees every A2 route
 * has one failure-audit fallback without editing `app.ts` during A2 work.
 */
export const createOrganizationRoutes = (options: OrganizationRoutesOptions) =>
  new Elysia({ name: "organization-routes", normalize: false })
    .use(createA2TransportAuditPlugin(options.actions))
    .use(createShopRoutes({
      service: options.services.shops,
      authenticate: options.authenticate,
      allowedOrigins: options.allowedOrigins,
    }))
    .use(createBranchRoutes({
      service: options.services.branches,
      authenticate: options.authenticate,
      allowedOrigins: options.allowedOrigins,
    }))
    .use(createDepartmentRoutes({
      service: options.services.departments,
      authenticate: options.authenticate,
      allowedOrigins: options.allowedOrigins,
    }))
    .use(createPositionRoutes({
      service: options.services.positions,
      authenticate: options.authenticate,
      allowedOrigins: options.allowedOrigins,
    }));
