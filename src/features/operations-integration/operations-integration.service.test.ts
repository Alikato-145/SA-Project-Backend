import { describe, expect, test } from "bun:test";
import type { AuthenticatedGrant } from "../../core/auth/auth.types";
import { ApplicationError } from "../../core/errors/application.error";
import { OperationsIntegrationService, type OperationsScopeRepository } from "./operations-integration.service";

const repository: OperationsScopeRepository = {
  assignmentAt: async () => ({ branchId: 8, departmentId: 3 }),
  branchShopId: async () => 1,
  payrollLocked: async () => false,
  workedDays: async () => 20,
  baseSalary: async () => "20000.00",
  projectedNetPay: async () => "10000.00",
  overtimeEligible: async () => true,
};

const actor = (grants: AuthenticatedGrant[], employeeId: string | null = null) => ({ accountId: "1", employeeId, username: "tester", grants });
const departmentGrant: AuthenticatedGrant = { grantId: "1", roleCode: "SUPERVISOR", scope: "department", branchId: "8", departmentId: "3" };

describe("operations integration scope", () => {
  test("permits a matching department actor and denies a different department", async () => {
    const service = new OperationsIntegrationService(repository);
    await service.assertEmployee(actor([departmentGrant]), 11, { branchId: 8, departmentId: 3 });
    await expect(service.assertEmployee(actor([departmentGrant]), 11, { branchId: 8, departmentId: 4 }))
      .rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" } satisfies Partial<ApplicationError>);
  });

  test("preserves the payroll lock guard for an operation date", async () => {
    const service = new OperationsIntegrationService({ ...repository, payrollLocked: async () => true });
    await expect(service.assertDateUnlocked(undefined, 11, "2026-09-28"))
      .rejects.toMatchObject({ code: "PAYROLL_PERIOD_LOCKED" } satisfies Partial<ApplicationError>);
  });

  test("allows only an all-scope HR or owner to manage finance", () => {
    const service = new OperationsIntegrationService(repository);
    expect(() => service.assertFinanceAdmin(actor([departmentGrant])))
      .toThrow(expect.objectContaining({ code: "FORBIDDEN_SCOPE" }));
    expect(() => service.assertFinanceAdmin(actor([{ grantId: "2", roleCode: "HR", scope: "all", branchId: null, departmentId: null }])))
      .not.toThrow();
  });

  test("accepts the raw authenticated actor placed on the route context", () => {
    const service = new OperationsIntegrationService(repository);
    const raw = actor([departmentGrant]);
    expect(service.authenticated(raw)).toBe(raw);
  });
});
