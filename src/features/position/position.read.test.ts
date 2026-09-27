import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { closeDatabase, db } from "../../core/db/client";
import type { DatabaseExecutor } from "../../core/db/transaction";
import { ApplicationError } from "../../core/errors/application.error";
import type { AuditEvent, AuditEventWriter } from "../audit/audit.repository";
import { createAuditService } from "../audit/audit.service";
import type {
  OrganizationPage,
  OrganizationVisibility,
  ParentFilteredPageInput,
  PositionRecord,
} from "../organization/organization.types";
import { branches } from "../branch/branch.schema";
import { departments } from "../department/department.schema";
import { shops } from "../shop/shop.schema";
import { createPositionController } from "./position.controller";
import {
  positionRepository,
  type PositionRepositoryPort,
} from "./position.repository";
import { createPositionRoutes } from "./position.routes";
import { positions } from "./position.schema";
import { createPositionService } from "./position.service";

const executor = {} as DatabaseExecutor;
const now = new Date("2026-09-22T00:00:00.000Z");
const position = (overrides: Partial<PositionRecord> = {}): PositionRecord => ({
  id: "41",
  shopId: "7",
  code: "CHEF",
  name: "Chef",
  isActive: true,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const actor = (
  grant: AuthenticatedActor["grants"][number],
): AuthenticatedActor => ({
  accountId: "9",
  employeeId: "5",
  username: "reader",
  grants: [grant],
});

const branchManager = actor({
  grantId: "1",
  roleCode: "BRANCH_MANAGER",
  scope: "branch",
  branchId: "13",
  departmentId: null,
});
const supervisor = actor({
  grantId: "2",
  roleCode: "SUPERVISOR",
  scope: "department",
  branchId: "13",
  departmentId: "21",
});
const employee = actor({
  grantId: "3",
  roleCode: "EMPLOYEE",
  scope: "self",
  branchId: null,
  departmentId: null,
});

const setup = (visibleShopIds: readonly string[] | null = ["7"]) => {
  const events: AuditEvent[] = [];
  const resolvedVisibilities: OrganizationVisibility[] = [];
  const pages: ParentFilteredPageInput[] = [];
  const detailIds: string[] = [];
  const repository: PositionRepositoryPort = {
    async resolveVisibleShopIds(_executor, visibility) {
      resolvedVisibilities.push(visibility);
      return visibleShopIds;
    },
    async findPage(_executor, input, shopIds) {
      pages.push(input);
      expect(shopIds).toEqual(visibleShopIds);
      return {
        items: [position()],
        page: input.page,
        pageSize: input.pageSize,
        total: 1,
      } satisfies OrganizationPage<PositionRecord>;
    },
    async findVisibleById(_executor, id, shopIds) {
      detailIds.push(id);
      expect(shopIds).toEqual(visibleShopIds);
      return id === "41" ? position() : null;
    },
    async findActiveShop() { throw new Error("not used"); },
    async findById() { throw new Error("not used"); },
    async insert() { throw new Error("not used"); },
    async update() { throw new Error("not used"); },
    async deactivate() { throw new Error("not used"); },
  };
  const writer: AuditEventWriter = {
    async insert(_executor, event) {
      events.push(event);
      return { id: events.length, action: event.action, requestId: event.requestId };
    },
  };
  const audit = createAuditService(executor, writer);
  const service = createPositionService({ repository, rootExecutor: executor, audit });
  return {
    controller: createPositionController(service),
    detailIds,
    events,
    pages,
    resolvedVisibilities,
    service,
  };
};

describe("position scoped reads", () => {
  test("derives position shop visibility from branch grants and audits the list", async () => {
    const fixture = setup(["7"]);
    const result = await fixture.service.listPositions({
      actor: branchManager,
      requestId: "position-list-branch",
      page: 2,
      pageSize: 10,
      search: "chef",
      isActive: true,
      shopId: null,
    });

    expect(result.items).toEqual([position()]);
    expect(fixture.resolvedVisibilities).toEqual([
      { all: false, branchIds: ["13"], departmentIds: [] },
    ]);
    expect(fixture.pages).toEqual([
      { page: 2, pageSize: 10, search: "chef", isActive: true, parentId: null },
    ]);
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0]).toMatchObject({
      action: "organization.position.list.succeeded",
      tableName: "positions",
      recordId: "collection",
    });
  });

  test("derives the parent shop through a supervisor department grant", async () => {
    const fixture = setup(["7"]);
    const result = await fixture.service.getPosition({
      actor: supervisor,
      requestId: "position-read-supervisor",
      positionId: "41",
    });

    expect(result).toEqual(position());
    expect(fixture.resolvedVisibilities).toEqual([
      { all: false, branchIds: [], departmentIds: ["21"] },
    ]);
    expect(fixture.detailIds).toEqual(["41"]);
    expect(fixture.events[0]?.action).toBe("organization.position.read.succeeded");
  });

  test("denies self scope before querying the repository", async () => {
    const fixture = setup([]);
    const error = await fixture.service.listPositions({
      actor: employee,
      requestId: "position-list-self",
      page: 1,
      pageSize: 20,
      search: null,
      isActive: true,
      shopId: null,
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(ApplicationError);
    expect(error.code).toBe("FORBIDDEN_SCOPE");
    expect(fixture.resolvedVisibilities).toHaveLength(0);
    expect(fixture.pages).toHaveLength(0);
    expect(fixture.events[0]).toMatchObject({
      action: "organization.position.list.failed",
      reason: "FORBIDDEN_SCOPE",
    });
  });

  test("hides an out-of-scope detail as RESOURCE_NOT_FOUND and audits failure", async () => {
    const fixture = setup([]);
    const error = await fixture.service.getPosition({
      actor: supervisor,
      requestId: "position-read-hidden",
      positionId: "41",
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(ApplicationError);
    expect(error.code).toBe("RESOURCE_NOT_FOUND");
    expect(fixture.detailIds).toHaveLength(0);
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0]).toMatchObject({
      action: "organization.position.read.failed",
      reason: "RESOURCE_NOT_FOUND",
    });
  });

  test("controller validates filters and maps stable snake_case responses", async () => {
    const fixture = setup(["7"]);
    const response = await fixture.controller.list({
      actor: branchManager,
      requestId: "position-controller-list",
      query: {
        page: "1",
        page_size: "20",
        search: "  chef  ",
        is_active: "true",
        shop_id: "7",
      },
    });

    expect(response).toEqual({
      data: [{
        id: "41",
        shop_id: "7",
        code: "CHEF",
        name: "Chef",
        is_active: true,
        created_at: "2026-09-22T00:00:00.000Z",
        updated_at: "2026-09-22T00:00:00.000Z",
      }],
      page: 1,
      page_size: 20,
      total: 1,
      request_id: "position-controller-list",
    });
    expect(fixture.pages[0]).toMatchObject({ search: "chef", parentId: "7" });
  });

  test("exposes independently composable list and detail GET routes", async () => {
    const fixture = setup(["7"]);
    const app = createPositionRoutes({
      service: fixture.service,
      authenticate: async () => branchManager,
    });
    const listResponse = await app.handle(new Request(
      "http://localhost/api/v1/positions?page=1&page_size=20&search=%20chef%20&shop_id=7",
      { headers: { "x-request-id": "position-http-list" } },
    ));
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toMatchObject({
      data: [{ id: "41", shop_id: "7", code: "CHEF" }],
      page: 1,
      page_size: 20,
      total: 1,
      request_id: "position-http-list",
    });

    const detailResponse = await app.handle(new Request(
      "http://localhost/api/v1/positions/41",
      { headers: { "x-request-id": "position-http-detail" } },
    ));
    expect(detailResponse.status).toBe(200);
    expect(await detailResponse.json()).toMatchObject({
      data: { id: "41", shop_id: "7" },
      request_id: "position-http-detail",
    });

    const bigintResponse = await app.handle(new Request(
      "http://localhost/api/v1/positions/9007199254740991",
      { headers: { "x-request-id": "position-http-bigint" } },
    ));
    expect(bigintResponse.status).toBe(404);
    expect(await bigintResponse.json()).toMatchObject({
      error: { code: "RESOURCE_NOT_FOUND" },
      request_id: "position-http-bigint",
    });

    const unsafeResponse = await app.handle(new Request(
      "http://localhost/api/v1/positions/9007199254740992",
    ));
    expect(unsafeResponse.status).toBe(422);
  });
});

const databaseDescribe = process.env.A2_DATABASE_INTEGRATION === "1"
  ? describe
  : describe.skip;

databaseDescribe("position repository scope derivation", () => {
  const suffix = `${process.pid}${Date.now()}`.slice(-10);
  const shopIds: number[] = [];
  const branchIds: number[] = [];
  const departmentIds: number[] = [];
  const positionIds: number[] = [];

  beforeAll(async () => {
    const insertedShops = await db.insert(shops).values([
      { code: `PS1${suffix}`, name: "Position shop one" },
      { code: `PS2${suffix}`, name: "Position shop two" },
    ]).returning();
    shopIds.push(...insertedShops.map((row) => row.id));
    const insertedBranches = await db.insert(branches).values([
      { shopId: shopIds[0]!, code: `PB1${suffix}`, name: "Position branch one" },
      { shopId: shopIds[1]!, code: `PB2${suffix}`, name: "Position branch two" },
    ]).returning();
    branchIds.push(...insertedBranches.map((row) => row.id));
    const insertedDepartments = await db.insert(departments).values([
      { branchId: branchIds[0]!, code: `PD1${suffix}`, name: "Position department one" },
      { branchId: branchIds[1]!, code: `PD2${suffix}`, name: "Position department two" },
    ]).returning();
    departmentIds.push(...insertedDepartments.map((row) => row.id));
    const insertedPositions = await db.insert(positions).values([
      { shopId: shopIds[0]!, code: `PA${suffix}`, name: "Alpha" },
      { shopId: shopIds[0]!, code: `PB${suffix}`, name: "Beta", isActive: false },
      { shopId: shopIds[1]!, code: `PC${suffix}`, name: "Gamma" },
    ]).returning();
    positionIds.push(...insertedPositions.map((row) => row.id));
  });

  afterAll(async () => {
    if (positionIds.length > 0) {
      await db.delete(positions).where(inArray(positions.id, positionIds));
    }
    if (departmentIds.length > 0) {
      await db.delete(departments).where(inArray(departments.id, departmentIds));
    }
    if (branchIds.length > 0) {
      await db.delete(branches).where(inArray(branches.id, branchIds));
    }
    for (const shopId of shopIds) {
      await db.delete(shops).where(eq(shops.id, shopId));
    }
  });

  test("derives shops from branch and department grants and intersects filters", async () => {
    const branchShopIds = await positionRepository.resolveVisibleShopIds(db, {
      all: false,
      branchIds: [String(branchIds[0])],
      departmentIds: [],
    });
    expect(branchShopIds).toEqual([String(shopIds[0])]);
    const branchPage = await positionRepository.findPage(db, {
      page: 1,
      pageSize: 20,
      search: null,
      isActive: true,
      parentId: null,
    }, branchShopIds);
    expect(branchPage.items.map((row) => row.id)).toEqual([String(positionIds[0])]);

    const departmentShopIds = await positionRepository.resolveVisibleShopIds(db, {
      all: false,
      branchIds: [],
      departmentIds: [String(departmentIds[1])],
    });
    expect(departmentShopIds).toEqual([String(shopIds[1])]);
    const outsideParent = await positionRepository.findPage(db, {
      page: 1,
      pageSize: 20,
      search: null,
      isActive: true,
      parentId: String(shopIds[0]),
    }, departmentShopIds);
    expect(outsideParent).toMatchObject({ items: [], total: 0 });
  });

  test("keeps inactive filtering and hidden details inside resolved shop scope", async () => {
    const visibleShopIds = [String(shopIds[0])];
    const inactive = await positionRepository.findPage(db, {
      page: 1,
      pageSize: 20,
      search: "Beta",
      isActive: false,
      parentId: String(shopIds[0]),
    }, visibleShopIds);
    expect(inactive.items.map((row) => row.id)).toEqual([String(positionIds[1])]);
    expect(await positionRepository.findVisibleById(
      db,
      String(positionIds[2]),
      visibleShopIds,
    )).toBeNull();
  });
});

afterAll(async () => {
  if (process.env.A2_DATABASE_INTEGRATION === "1") await closeDatabase();
});
