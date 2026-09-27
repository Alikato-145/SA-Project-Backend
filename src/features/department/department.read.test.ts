import { describe, expect, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { DatabaseExecutor } from "../../core/db/transaction";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { AuditEvent, AuditEventWriter } from "../audit/audit.repository";
import { createAuditService } from "../audit/audit.service";
import type { DepartmentRecord } from "../organization/organization.types";
import { departmentVisibilityCondition, type DepartmentRepositoryPort } from "./department.repository";
import { createDepartmentService } from "./department.service";
import { createDepartmentRoutes } from "./department.routes";

describe("department scoped repository reads", () => {
  const compile = (visibility: Parameters<typeof departmentVisibilityCondition>[0]) => {
    const condition = departmentVisibilityCondition(visibility);
    return condition === undefined ? null : new PgDialect().sqlToQuery(condition);
  };

  test("branch grants compile to branch-wide department visibility", () => {
    expect(compile({ all: false, branchIds: ["4", "5"], departmentIds: [] })).toMatchObject({
      sql: '"departments"."branch_id" in ($1, $2)',
      params: [4, 5],
    });
  });

  test("supervisor grants compile to exact department visibility and combine by union", () => {
    expect(compile({ all: false, branchIds: [], departmentIds: ["17"] })).toMatchObject({
      sql: '"departments"."id" in ($1)',
      params: [17],
    });
    expect(compile({ all: false, branchIds: ["4"], departmentIds: ["17"] })).toMatchObject({
      sql: '("departments"."branch_id" in ($1) or "departments"."id" in ($2))',
      params: [4, 17],
    });
  });

  test("all scope needs no restriction and empty visibility fails closed", () => {
    expect(compile({ all: true, branchIds: [], departmentIds: [] })).toBeNull();
    expect(compile({ all: false, branchIds: [], departmentIds: [] })).toMatchObject({
      sql: "false",
      params: [],
    });
  });
});

const record: DepartmentRecord = {
  id: "17",
  branchId: "4",
  code: "KITCHEN",
  name: "Kitchen",
  isActive: true,
  createdAt: new Date("2026-09-20T01:02:03.000Z"),
  updatedAt: new Date("2026-09-21T04:05:06.000Z"),
};

const branchManager: AuthenticatedActor = {
  accountId: "9",
  employeeId: "2",
  username: "manager",
  grants: [{ grantId: "1", roleCode: "BRANCH_MANAGER", scope: "branch", branchId: "4", departmentId: null }],
};

const supervisor: AuthenticatedActor = {
  accountId: "10",
  employeeId: "3",
  username: "supervisor",
  grants: [{ grantId: "2", roleCode: "SUPERVISOR", scope: "department", branchId: "4", departmentId: "17" }],
};

const serviceFixture = (overrides: Partial<DepartmentRepositoryPort> = {}) => {
  const events: AuditEvent[] = [];
  const writer: AuditEventWriter = {
    async insert(_executor, event) {
      events.push(event);
      return { id: events.length, action: event.action, requestId: event.requestId };
    },
  };
  const repository: DepartmentRepositoryPort = {
    async findVisiblePage(_executor, input, visibility) {
      expect(input).toEqual({ page: 2, pageSize: 5, search: "Kit", isActive: true, parentId: "4" });
      return { items: [record], page: input.page, pageSize: input.pageSize, total: 1 };
    },
    async findVisibleById(_executor, id, visibility) {
      return id === record.id && (visibility.all || visibility.departmentIds.includes(record.id) || visibility.branchIds.includes(record.branchId))
        ? record
        : null;
    },
    async findActiveParentChain() { throw new Error("not used"); },
    async findById() { throw new Error("not used"); },
    async insert() { throw new Error("not used"); },
    async update() { throw new Error("not used"); },
    async deactivate() { throw new Error("not used"); },
    ...overrides,
  };
  const rootExecutor = {} as DatabaseExecutor;
  return {
    events,
    service: createDepartmentService({ repository, rootExecutor, audit: createAuditService(rootExecutor, writer) }),
  };
};

describe("department read service and transport", () => {
  test("projects branch scope for lists and records one successful action", async () => {
    let receivedVisibility: unknown;
    const fixture = serviceFixture({
      async findVisiblePage(_executor, input, visibility) {
        receivedVisibility = visibility;
        return { items: [record], page: input.page, pageSize: input.pageSize, total: 1 };
      },
    });
    const result = await fixture.service.listDepartments({
      actor: branchManager,
      requestId: "department-list",
      page: 2,
      pageSize: 5,
      search: "Kit",
      isActive: true,
      branchId: "4",
    });
    expect(receivedVisibility).toEqual({ all: false, branchIds: ["4"], departmentIds: [] });
    expect(result.items).toEqual([record]);
    expect(fixture.events.map((event) => event.action)).toEqual(["organization.department.list.succeeded"]);
  });

  test("projects exact supervisor scope and audits a hidden detail as RESOURCE_NOT_FOUND", async () => {
    const fixture = serviceFixture();
    const visible = await fixture.service.getDepartment({ actor: supervisor, requestId: "department-visible", departmentId: "17" });
    expect(visible).toEqual(record);

    const error = await fixture.service.getDepartment({ actor: supervisor, requestId: "department-hidden", departmentId: "18" }).catch((caught) => caught);
    expect(error.code).toBe("RESOURCE_NOT_FOUND");
    expect(fixture.events.map((event) => [event.action, event.reason])).toEqual([
      ["organization.department.read.succeeded", null],
      ["organization.department.read.failed", "RESOURCE_NOT_FOUND"],
    ]);
  });

  test("rejects self-only actors before list or detail persistence", async () => {
    let repositoryCalls = 0;
    const fixture = serviceFixture({
      async findVisiblePage() {
        repositoryCalls += 1;
        throw new Error("repository must not be reached");
      },
      async findVisibleById() {
        repositoryCalls += 1;
        throw new Error("repository must not be reached");
      },
    });
    const employee: AuthenticatedActor = {
      accountId: "11",
      employeeId: "7",
      username: "employee",
      grants: [{ grantId: "3", roleCode: "EMPLOYEE", scope: "self", branchId: null, departmentId: null }],
    };

    const listError = await fixture.service.listDepartments({
      actor: employee,
      requestId: "department-self-list",
      page: 1,
      pageSize: 20,
      search: null,
      isActive: true,
      branchId: null,
    }).catch((caught) => caught);
    const detailError = await fixture.service.getDepartment({
      actor: employee,
      requestId: "department-self-detail",
      departmentId: "17",
    }).catch((caught) => caught);

    expect(listError.code).toBe("FORBIDDEN_SCOPE");
    expect(detailError.code).toBe("FORBIDDEN_SCOPE");
    expect(repositoryCalls).toBe(0);
    expect(fixture.events.map((event) => [event.action, event.reason])).toEqual([
      ["organization.department.list.failed", "FORBIDDEN_SCOPE"],
      ["organization.department.read.failed", "FORBIDDEN_SCOPE"],
    ]);
  });

  test("maps snake_case responses and exposes composable GET routes", async () => {
    const fixture = serviceFixture();
    const app = createDepartmentRoutes({
      service: fixture.service,
      authenticate: async () => branchManager,
      allowedOrigins: ["http://localhost"],
    });

    const listResponse = await app.handle(new Request("http://localhost/api/v1/departments?page=2&page_size=5&search=%20Kit%20&is_active=true&branch_id=4", {
      headers: { "x-request-id": "department-http-list" },
    }));
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toEqual({
      data: [{
        id: "17",
        branch_id: "4",
        code: "KITCHEN",
        name: "Kitchen",
        is_active: true,
        created_at: "2026-09-20T01:02:03.000Z",
        updated_at: "2026-09-21T04:05:06.000Z",
      }],
      page: 2,
      page_size: 5,
      total: 1,
      request_id: "department-http-list",
    });

    const detailResponse = await app.handle(new Request("http://localhost/api/v1/departments/17", {
      headers: { "x-request-id": "department-http-detail" },
    }));
    expect(detailResponse.status).toBe(200);
    expect((await detailResponse.json()).data.branch_id).toBe("4");
  });
});
