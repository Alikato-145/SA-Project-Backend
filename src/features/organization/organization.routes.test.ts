import { describe, expect, test } from "bun:test";
import { A2_ACTION_REGISTRY } from "../../core/audit/a2-transport-audit.plugin";
import { createOrganizationRoutes } from "./organization.routes";

const expectedRoutes = [
  "GET /api/v1/shops",
  "POST /api/v1/shops",
  "GET /api/v1/shops/:shopId",
  "PATCH /api/v1/shops/:shopId",
  "POST /api/v1/shops/:shopId/deactivate",
  "GET /api/v1/branches",
  "POST /api/v1/branches",
  "GET /api/v1/branches/:branch_id",
  "PATCH /api/v1/branches/:branch_id",
  "POST /api/v1/branches/:branch_id/deactivate",
  "GET /api/v1/departments",
  "POST /api/v1/departments",
  "GET /api/v1/departments/:department_id",
  "PATCH /api/v1/departments/:department_id",
  "POST /api/v1/departments/:department_id/deactivate",
  "GET /api/v1/positions",
  "POST /api/v1/positions",
  "GET /api/v1/positions/:position_id",
  "PATCH /api/v1/positions/:position_id",
  "POST /api/v1/positions/:position_id/deactivate",
] as const;

describe("organization route composition", () => {
  test("exports exactly the 20 A2 endpoints and no hard-delete method", () => {
    const app = createOrganizationRoutes({
      actions: {} as never,
      services: {
        shops: {} as never,
        branches: {} as never,
        departments: {} as never,
        positions: {} as never,
      },
      async authenticate() { throw new Error("not invoked during composition"); },
      allowedOrigins: [],
    });

    const routes = app.routes.map(({ method, path }) => `${method} ${path}`);
    expect(routes).toHaveLength(20);
    expect(new Set(routes)).toEqual(new Set(expectedRoutes));
    expect(routes.some((route) => route.startsWith("DELETE "))).toBe(false);
    expect(A2_ACTION_REGISTRY).toHaveLength(routes.length);
  });
});
