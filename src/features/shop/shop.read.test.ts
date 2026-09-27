import { describe, expect, test } from "bun:test";
import { ActionObserver } from "../../core/audit/action-observer";
import { DomainAuditObserver } from "../../core/audit/domain-audit-observer";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { AuditReceipt } from "../audit/audit.repository";
import type { AuditService } from "../audit/audit.service";
import type { OrganizationVisibility, ShopRecord } from "../organization/organization.types";
import { createShopService } from "./shop.service";
import type { ShopRepositoryPort } from "./shop.repository";

const now = new Date("2026-09-22T00:00:00.000Z");
const shop: ShopRecord = {
  id: "1", code: "HQ", name: "Headquarters", isActive: true,
  createdAt: now, updatedAt: now,
};

const actor = (grants: AuthenticatedActor["grants"]): AuthenticatedActor => ({
  accountId: "9", employeeId: null, username: "reader", grants,
});

const owner = actor([{
  grantId: "1", roleCode: "OWNER", scope: "all",
  branchId: null, departmentId: null,
}]);

const branchManager = actor([{
  grantId: "2", roleCode: "BRANCH_MANAGER", scope: "branch",
  branchId: "10", departmentId: null,
}]);

const employee = actor([{
  grantId: "3", roleCode: "EMPLOYEE", scope: "self",
  branchId: null, departmentId: null,
}]);

const setup = (overrides: Partial<ShopRepositoryPort> = {}) => {
  const visibility: OrganizationVisibility[] = [];
  const events: { action: string; reason?: string | null }[] = [];
  const repository: ShopRepositoryPort = {
    async list(_executor, query, scope) {
      visibility.push(scope);
      return { items: [shop], page: query.page, pageSize: query.pageSize, total: 1 };
    },
    async findById(_executor, _id, scope) {
      visibility.push(scope);
      return shop;
    },
    async insert() { throw new Error("not used"); },
    async update() { throw new Error("not used"); },
    async deactivate() { throw new Error("not used"); },
    ...overrides,
  };
  const writer = {
    async insert(_executor: never, event: { action: string; requestId: string; reason?: string | null }): Promise<AuditReceipt> {
      events.push({ action: event.action, reason: event.reason });
      return { id: events.length, action: event.action, requestId: event.requestId };
    },
  };
  const audit = {
    actions: new ActionObserver({} as never, writer as never),
    domain: new DomainAuditObserver(writer as never),
    async queryAuditLogs() { throw new Error("not used"); },
  } satisfies AuditService;
  return {
    events,
    visibility,
    service: createShopService({ repository, rootExecutor: {} as never, audit }),
  };
};

describe("shop scoped reads", () => {
  test("lists all shops for Owner and emits one correlated action outcome", async () => {
    const fixture = setup();
    const result = await fixture.service.listShops({
      actor: owner, requestId: "shop-list", page: 1, pageSize: 20,
      search: null, isActive: true,
    });
    expect(result.items).toEqual([shop]);
    expect(fixture.visibility).toEqual([{ all: true, branchIds: [], departmentIds: [] }]);
    expect(fixture.events).toEqual([{ action: "organization.shop.list.succeeded", reason: null }]);
  });

  test("passes branch scope so the repository can derive only its parent shop", async () => {
    const fixture = setup();
    await fixture.service.getShop({ actor: branchManager, requestId: "shop-read", shopId: "1" });
    expect(fixture.visibility).toEqual([{ all: false, branchIds: ["10"], departmentIds: [] }]);
  });

  test("fails Employee self scope closed without querying and audits the denial", async () => {
    let reads = 0;
    const fixture = setup({ async list() { reads += 1; throw new Error("unreachable"); } });
    await expect(fixture.service.listShops({
      actor: employee, requestId: "shop-denied", page: 1, pageSize: 20,
      search: null, isActive: true,
    })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
    expect(reads).toBe(0);
    expect(fixture.events).toEqual([{ action: "organization.shop.list.failed", reason: "FORBIDDEN_SCOPE" }]);
  });

  test("does not disclose a missing or out-of-scope detail", async () => {
    const fixture = setup({ async findById() { return null; } });
    await expect(fixture.service.getShop({
      actor: branchManager, requestId: "shop-hidden", shopId: "99",
    })).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    expect(fixture.events).toHaveLength(1);
  });
});
