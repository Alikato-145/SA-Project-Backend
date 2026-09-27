import { describe, expect, test } from "bun:test";
import { ActionObserver } from "../../core/audit/action-observer";
import { DomainAuditObserver } from "../../core/audit/domain-audit-observer";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { AuditReceipt } from "../audit/audit.repository";
import type { AuditService } from "../audit/audit.service";
import type { ShopRepositoryPort } from "../shop/shop.repository";
import { createShopService } from "../shop/shop.service";
import type {
  OrganizationPageInput,
  OrganizationVisibility,
  ShopRecord,
} from "./organization.types";

const owner: AuthenticatedActor = {
  accountId: "9",
  employeeId: null,
  username: "performance-owner",
  grants: [{
    grantId: "1",
    roleCode: "OWNER",
    scope: "all",
    branchId: null,
    departmentId: null,
  }],
};

const fixtureDate = new Date("2026-09-22T00:00:00.000Z");
const shops: ShopRecord[] = Array.from({ length: 1_000 }, (_, index) => {
  const number = index + 1;
  return {
    id: String(number),
    code: `S${String(number).padStart(4, "0")}`,
    name: `${number % 4 === 0 ? "North" : "South"} Hub ${number}`,
    isActive: number % 2 === 0,
    createdAt: fixtureDate,
    updatedAt: fixtureDate,
  };
});

const createInMemoryRepository = (): ShopRepositoryPort => ({
  async list(
    _executor,
    query: OrganizationPageInput,
    visibility: OrganizationVisibility,
  ) {
    if (!visibility.all) throw new Error("performance fixture expects all-branch visibility");

    const needle = query.search?.toLocaleLowerCase("en") ?? null;
    const filtered = shops
      .filter((shop) => shop.isActive === query.isActive)
      .filter((shop) => !needle
        || shop.code.toLocaleLowerCase("en").includes(needle)
        || shop.name.toLocaleLowerCase("en").includes(needle))
      .sort((left, right) => left.code.localeCompare(right.code)
        || Number(left.id) - Number(right.id));
    const offset = (query.page - 1) * query.pageSize;

    return {
      items: filtered.slice(offset, offset + query.pageSize),
      page: query.page,
      pageSize: query.pageSize,
      total: filtered.length,
    };
  },
  async findById() { throw new Error("not used"); },
  async insert() { throw new Error("not used"); },
  async update() { throw new Error("not used"); },
  async deactivate() { throw new Error("not used"); },
});

const createAuditFixture = () => {
  const actions: string[] = [];
  const writer = {
    async insert(
      _executor: never,
      event: { action: string; requestId: string },
    ): Promise<AuditReceipt> {
      actions.push(event.action);
      return { id: actions.length, action: event.action, requestId: event.requestId };
    },
  };
  const audit = {
    actions: new ActionObserver({} as never, writer as never),
    domain: new DomainAuditObserver(writer as never),
    async queryAuditLogs() { throw new Error("not used"); },
  } satisfies AuditService;
  return { actions, audit };
};

describe("organization filtered pagination performance", () => {
  test("filters and paginates 1,000 shops within two seconds", async () => {
    const { actions, audit } = createAuditFixture();
    const service = createShopService({
      repository: createInMemoryRepository(),
      rootExecutor: {} as never,
      audit,
    });

    const startedAt = performance.now();
    const result = await service.listShops({
      actor: owner,
      requestId: "organization-performance-1000",
      page: 3,
      pageSize: 25,
      search: "north",
      isActive: true,
    });
    const elapsedMilliseconds = performance.now() - startedAt;

    expect(result).toMatchObject({ page: 3, pageSize: 25, total: 250 });
    expect(result.items).toHaveLength(25);
    expect(result.items[0]?.id).toBe("204");
    expect(result.items.at(-1)?.id).toBe("300");
    expect(result.items.every((shop) => shop.isActive && shop.name.includes("North"))).toBe(true);
    expect(actions).toEqual(["organization.shop.list.succeeded"]);
    expect(elapsedMilliseconds).toBeLessThan(2_000);
  });
});
