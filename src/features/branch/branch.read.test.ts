import { describe, expect, test } from "bun:test";
import { ActionObserver } from "../../core/audit/action-observer";
import { DomainAuditObserver } from "../../core/audit/domain-audit-observer";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { AuditReceipt } from "../audit/audit.repository";
import type { AuditService } from "../audit/audit.service";
import type { BranchRecord } from "../organization/organization.types";
import { toBranchResponseDto } from "./branch.mapper";
import { branchRepository } from "./branch.repository";
import { createBranchRoutes } from "./branch.routes";
import {
  createBranchService,
  type BranchRepositoryPort,
} from "./branch.service";

const record: BranchRecord = {
  id: "7",
  shopId: "3",
  code: "BKK-01",
  name: "Bangkok Main",
  address: "1 Main Road",
  timezone: "Asia/Bangkok",
  isActive: true,
  createdAt: new Date("2026-09-20T01:02:03.000Z"),
  updatedAt: new Date("2026-09-21T04:05:06.000Z"),
};

const actor = (
  grants: AuthenticatedActor["grants"],
): AuthenticatedActor => ({
  accountId: "10",
  employeeId: "20",
  username: "reader",
  grants,
});

const owner = actor([
  {
    grantId: "1",
    roleCode: "OWNER",
    scope: "all",
    branchId: null,
    departmentId: null,
  },
]);

const setup = (override: Partial<BranchRepositoryPort> = {}) => {
  const calls: Array<{ kind: "list" | "detail"; input: unknown }> = [];
  const events: Array<{ action: string; outcome: string }> = [];
  const repository: BranchRepositoryPort = {
    async findPage(_executor, input) {
      calls.push({ kind: "list", input });
      const hidden =
        !input.visibility.all &&
        input.visibility.branchIds.length === 0 &&
        input.visibility.departmentIds.length === 0;
      return {
        items: hidden ? [] : [record],
        page: input.page,
        pageSize: input.pageSize,
        total: hidden ? 0 : 1,
      };
    },
    async findVisibleById(_executor, id, visibility) {
      calls.push({ kind: "detail", input: { id, visibility } });
      return id === record.id ? record : null;
    },
    async findActiveShop() {
      return true;
    },
    async findById(_executor, id) {
      return id === record.id ? record : null;
    },
    async insert() {
      return record;
    },
    async update(_executor, id) {
      return id === record.id ? record : null;
    },
    async deactivate(_executor, id) {
      return id === record.id ? { ...record, isActive: false } : null;
    },
    ...override,
  };
  const writer = {
    async insert(
      _executor: never,
      event: { action: string; requestId: string },
    ): Promise<AuditReceipt> {
      events.push({
        action: event.action.replace(/\.(?:succeeded|failed)$/, ""),
        outcome: event.action.endsWith(".failed") ? "failed" : "succeeded",
      });
      return { id: events.length, action: event.action, requestId: event.requestId };
    },
  };
  const audit = {
    actions: new ActionObserver({} as never, writer as never),
    domain: new DomainAuditObserver(writer as never),
    async queryAuditLogs() {
      throw new Error("not used");
    },
  } satisfies AuditService;
  return {
    calls,
    events,
    service: createBranchService({
      repository,
      rootExecutor: {} as never,
      transactionRunner: {
        async transaction(work) {
          return work({} as never);
        },
      },
      audit,
    }),
  };
};

describe("branch scoped reads", () => {
  test("passes all-scope and list filters to persistence and audits once", async () => {
    const { service, calls, events } = setup();
    const page = await service.listBranches({
      actor: owner,
      requestId: "req-list",
      page: 2,
      pageSize: 25,
      search: "bangkok",
      isActive: false,
      shopId: "3",
    });

    expect(page).toEqual({ items: [record], page: 2, pageSize: 25, total: 1 });
    expect(calls[0]).toEqual({
      kind: "list",
      input: {
        page: 2,
        pageSize: 25,
        search: "bangkok",
        isActive: false,
        parentId: "3",
        visibility: { all: true, branchIds: [], departmentIds: [] },
      },
    });
    expect(events).toEqual([
      { action: "organization.branch.list", outcome: "succeeded" },
    ]);
  });

  test("keeps supervisor department scope for repository-side parent derivation", async () => {
    const supervisor = actor([
      {
        grantId: "2",
        roleCode: "SUPERVISOR",
        scope: "department",
        branchId: "999",
        departmentId: "41",
      },
    ]);
    const { service, calls } = setup();

    await service.listBranches({
      actor: supervisor,
      requestId: "req-supervisor",
      page: 1,
      pageSize: 20,
      search: null,
      isActive: true,
      shopId: null,
    });

    expect(calls[0]).toMatchObject({
      input: {
        visibility: { all: false, branchIds: [], departmentIds: ["41"] },
      },
    });
  });

  test("passes only exact branch-manager branch IDs to persistence", async () => {
    const branchManager = actor([
      {
        grantId: "4",
        roleCode: "BRANCH_MANAGER",
        scope: "branch",
        branchId: "7",
        departmentId: null,
      },
    ]);
    const { service, calls } = setup();

    await service.listBranches({
      actor: branchManager,
      requestId: "req-manager",
      page: 1,
      pageSize: 20,
      search: null,
      isActive: true,
      shopId: null,
    });

    expect(calls[0]).toMatchObject({
      input: {
        visibility: { all: false, branchIds: ["7"], departmentIds: [] },
      },
    });
  });

  test("denies employee self scope before persistence and audits the failure", async () => {
    const employee = actor([
      {
        grantId: "3",
        roleCode: "EMPLOYEE",
        scope: "self",
        branchId: null,
        departmentId: null,
      },
    ]);
    const { service, calls } = setup();

    await expect(
      service.listBranches({
        actor: employee,
        requestId: "req-self",
        page: 1,
        pageSize: 20,
        search: null,
        isActive: true,
        shopId: null,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });

    expect(calls).toHaveLength(0);
  });

  test("returns hidden or absent branch detail as RESOURCE_NOT_FOUND and audits failure", async () => {
    const { service, events } = setup({
      async findVisibleById() {
        return null;
      },
    });

    await expect(
      service.getBranch({ actor: owner, requestId: "req-detail", id: "88" }),
    ).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    expect(events).toEqual([
      { action: "organization.branch.read", outcome: "failed" },
    ]);
  });

  test("maps persistence records to snake_case response DTOs", () => {
    expect(toBranchResponseDto(record)).toEqual({
      id: "7",
      shop_id: "3",
      code: "BKK-01",
      name: "Bangkok Main",
      address: "1 Main Road",
      timezone: "Asia/Bangkok",
      is_active: true,
      created_at: "2026-09-20T01:02:03.000Z",
      updated_at: "2026-09-21T04:05:06.000Z",
    });
  });

  test("repository fails closed without issuing a database query", async () => {
    const executor = new Proxy(
      {},
      {
        get() {
          throw new Error("database must not be queried");
        },
      },
    ) as never;
    const visibility = { all: false, branchIds: [], departmentIds: [] };

    expect(
      await branchRepository.findPage(executor, {
        page: 1,
        pageSize: 20,
        search: null,
        isActive: true,
        parentId: null,
        visibility,
      }),
    ).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
    expect(
      await branchRepository.findVisibleById(executor, "7", visibility),
    ).toBeNull();
  });

  test("exposes composable GET list/detail routes with public contracts", async () => {
    const { service } = setup();
    const app = createBranchRoutes({
      service,
      allowedOrigins: ["http://localhost"],
      async authenticate() {
        return owner;
      },
    });

    const listResponse = await app.handle(
      new Request(
        "http://localhost/api/v1/branches?page=2&page_size=25&search=bangkok&is_active=false&shop_id=3",
        { headers: { "x-request-id": "branch-list-request" } },
      ),
    );
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toMatchObject({
      data: [{ id: "7", shop_id: "3", is_active: true }],
      page: 2,
      page_size: 25,
      total: 1,
      request_id: expect.any(String),
    });

    const detailResponse = await app.handle(
      new Request("http://localhost/api/v1/branches/7", {
        headers: { "x-request-id": "branch-detail-request" },
      }),
    );
    expect(detailResponse.status).toBe(200);
    expect(await detailResponse.json()).toMatchObject({
      data: { id: "7", shop_id: "3", code: "BKK-01" },
      request_id: expect.any(String),
    });
  });
});
