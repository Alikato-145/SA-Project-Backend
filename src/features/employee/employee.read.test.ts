import { describe, expect, test } from "bun:test";
import { ActionObserver } from "../../core/audit/action-observer";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { AuditEvent } from "../audit/audit.repository";
import { createEmployeeController } from "./employee.controller";
import { toEmployeeHrDto } from "./employee.mapper";
import type { EmployeeReadRecord, EmployeeRepositoryPort } from "./employee.repository";
import { createEmployeeReadTestApp, employeeTestActor } from "./employee.test-support";
import { createEmployeeService } from "./employee.service";

const grant = (roleCode: AuthenticatedActor["grants"][number]["roleCode"], scope: AuthenticatedActor["grants"][number]["scope"], branchId: string | null = null, departmentId: string | null = null) =>
  ({ grantId: "1", roleCode, scope, branchId, departmentId });
const actor = (roleCode: AuthenticatedActor["grants"][number]["roleCode"], employeeId: string | null = null): AuthenticatedActor => ({
  accountId: "99", employeeId, username: roleCode.toLowerCase(),
  grants: [roleCode === "OWNER" || roleCode === "HR" ? grant(roleCode, "all")
    : roleCode === "BRANCH_MANAGER" ? grant(roleCode, "branch", "10")
      : roleCode === "SUPERVISOR" ? grant(roleCode, "department", "10", "100")
        : grant(roleCode, "self")],
});
const makeRecord = (id: number, branchId: number, departmentId: number): EmployeeReadRecord => ({
  id: String(id), employeeCode: `E${String(id).padStart(4, "0")}`,
  firstName: "Given", lastName: `Person${id}`, nationalId: "1234567890123", passportId: null,
  phone: "0812345678", personalEmail: "private@example.test", address: "Private address",
  hireDate: "2026-01-01", status: "active", terminatedAt: null,
  currentAssignment: { branchId: String(branchId), departmentId: String(departmentId), positionId: "1000" },
});
const records = [makeRecord(1, 10, 100), makeRecord(2, 10, 200), makeRecord(3, 20, 300)];

const setup = (source = records) => {
  const events: AuditEvent[] = [];
  const actions = new ActionObserver({} as never, {
    async insert(_executor, event) { events.push(event); return { id: events.length, action: event.action, requestId: event.requestId }; },
  });
  const repository: EmployeeRepositoryPort = {
    async list(_executor, query, visibility) {
      const visible = source.filter((record) => visibility.all || record.id === visibility.selfEmployeeId ||
        visibility.branchIds.includes(record.currentAssignment!.branchId) ||
        visibility.departments.some((scope) => scope.branchId === record.currentAssignment!.branchId && scope.departmentId === record.currentAssignment!.departmentId));
      const filtered = visible.filter((record) =>
        (query.status === null || record.status === query.status) &&
        (query.branchId === null || record.currentAssignment?.branchId === query.branchId) &&
        (query.departmentId === null || record.currentAssignment?.departmentId === query.departmentId) &&
        (query.search === null || `${record.employeeCode} ${record.firstName} ${record.lastName}`.toLowerCase().includes(query.search.toLowerCase())));
      return { items: filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), page: query.page, pageSize: query.pageSize, total: filtered.length };
    },
    async findById(_executor, id, visibility) {
      const record = source.find((item) => item.id === id) ?? null;
      return record && (visibility.all || record.id === visibility.selfEmployeeId ||
        visibility.branchIds.includes(record.currentAssignment!.branchId) ||
        visibility.departments.some((scope) => scope.branchId === record.currentAssignment!.branchId && scope.departmentId === record.currentAssignment!.departmentId)) ? record : null;
    },
  };
  const service = createEmployeeService({ rootExecutor: {} as never, repository, actions, today: () => "2026-09-23" });
  return { controller: createEmployeeController(service), service, events, actions };
};

describe("A3 scoped employee reads", () => {
  test("five roles see only current authorized records and field sets", async () => {
    const expected = [
      [actor("EMPLOYEE", "1"), ["1"]],
      [actor("SUPERVISOR"), ["1"]],
      [actor("BRANCH_MANAGER"), ["1", "2"]],
      [actor("HR"), ["1", "2", "3"]],
      [actor("OWNER"), ["1", "2", "3"]],
    ] as const;
    for (const [subject, ids] of expected) {
      const { controller, events } = setup();
      const result = await controller.list({ actor: subject, requestId: "req-1", query: {} });
      expect(result.data.map((item) => item.id)).toEqual([...ids]);
      expect(events).toHaveLength(1);
      expect(JSON.stringify(result)).not.toContain("1234567890123");
      if (subject.grants[0]!.scope === "department" || subject.grants[0]!.scope === "branch") {
        expect(JSON.stringify(result)).not.toContain("private@example.test");
        expect(JSON.stringify(result)).not.toContain("0812345678");
      }
    }
  });

  test("hidden detail is indistinguishable from absent; revoked grant cannot read", async () => {
    const { service, events } = setup();
    await expect(service.getEmployee({ actor: actor("SUPERVISOR"), requestId: "req-2", employeeId: "3" }))
      .rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    await expect(service.getEmployee({ actor: actor("SUPERVISOR"), requestId: "req-3", employeeId: "999" }))
      .rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    const revoked = { ...actor("OWNER"), grants: [{ ...grant("OWNER", "all"), roleActive: false }] } as unknown as AuthenticatedActor;
    await expect(service.listEmployees({ actor: revoked, requestId: "req-4", page: 1, pageSize: 20, search: null, status: null, branchId: null, departmentId: null }))
      .rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
    expect(events).toHaveLength(3);
  });

  test("1,000 rows page stably without serializing private values", async () => {
    const source = Array.from({ length: 1000 }, (_, index) => makeRecord(index + 1, 10, 100));
    const { controller } = setup(source);
    const started = performance.now();
    const result = await controller.list({ actor: actor("HR"), requestId: "req-5", query: { page: "10", page_size: "100" } });
    expect(result.total).toBe(1000);
    expect(result.data).toHaveLength(100);
    expect(result.data[0]?.id).toBe("901");
    expect(performance.now() - started).toBeLessThan(2000);
  });

  test("test-only HTTP composition applies scope, safe errors and audit once", async () => {
    const fixture = setup();
    const app = createEmployeeReadTestApp({
      service: fixture.service, actions: fixture.actions,
      authenticate: async (request) => employeeTestActor(request.headers.get("x-role") as AuthenticatedActor["grants"][number]["roleCode"]),
    });
    const list = await app.handle(new Request("http://localhost/api/v1/employees?page=1&page_size=1", {
      headers: { "x-role": "SUPERVISOR", "x-request-id": "http-list" },
    }));
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ total: 1, data: [{ id: "1" }], request_id: "http-list" });
    const hidden = await app.handle(new Request("http://localhost/api/v1/employees/3", {
      headers: { "x-role": "SUPERVISOR", "x-request-id": "http-hidden" },
    }));
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toMatchObject({ error: { code: "RESOURCE_NOT_FOUND" }, request_id: "http-hidden" });
    expect(fixture.events.map((event) => event.action)).toEqual([
      "employee.profile.list.succeeded", "employee.profile.read.failed",
    ]);
  });

  test("short identity values are never returned in full", () => {
    const record = { ...makeRecord(1, 10, 100), passportId: "A12" };
    const dto = toEmployeeHrDto(record);
    expect(dto.passport_id_masked).toBe("••••");
    expect(JSON.stringify(dto)).not.toContain("A12");
  });

  test("invalid HTTP filter fails safely with one transport audit outcome", async () => {
    const fixture = setup();
    const app = createEmployeeReadTestApp({
      service: fixture.service, actions: fixture.actions,
      authenticate: async () => employeeTestActor("HR"),
    });
    const response = await app.handle(new Request("http://localhost/api/v1/employees?page=0", {
      headers: { "x-request-id": "invalid-page" },
    }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0]?.action).toBe("employee.profile.list.failed");
  });
});
