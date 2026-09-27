import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { ActionObserver } from "../../core/audit/action-observer";
import { DomainAuditObserver } from "../../core/audit/domain-audit-observer";
import { closeDatabase, db } from "../../core/db/client";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { DatabaseExecutor, TransactionRunner } from "../../core/db/transaction";
import type { AuditEvent, AuditEventWriter, AuditReceipt } from "../audit/audit.repository";
import type { AuditService } from "../audit/audit.service";
import { branches } from "../branch/branch.schema";
import type { DepartmentRecord } from "../organization/organization.types";
import { shops } from "../shop/shop.schema";
import {
  parseCreateDepartmentRequest,
  parseDeactivateDepartmentRequest,
  parseUpdateDepartmentRequest,
} from "./department.dto";
import {
  departmentRepository,
  type DepartmentRepositoryPort,
} from "./department.repository";
import { createDepartmentRoutes } from "./department.routes";
import { departments } from "./department.schema";
import { createDepartmentService } from "./department.service";

const fixedNow = new Date("2026-09-22T03:00:00.000Z");
const existing: DepartmentRecord = {
  id: "17",
  branchId: "4",
  code: "KITCHEN",
  name: "Kitchen",
  isActive: true,
  createdAt: fixedNow,
  updatedAt: fixedNow,
};

const actor = (roleCode: "OWNER" | "HR" | "BRANCH_MANAGER"): AuthenticatedActor => ({
  accountId: "10",
  employeeId: null,
  username: roleCode.toLowerCase(),
  grants: [{
    grantId: "1",
    roleCode,
    scope: roleCode === "BRANCH_MANAGER" ? "branch" : "all",
    branchId: roleCode === "BRANCH_MANAGER" ? "4" : null,
    departmentId: null,
  }],
});

const setup = (options: {
  parentActive?: boolean;
  auditFailure?: Error;
  deactivateRace?: boolean;
} = {}) => {
  let stored: DepartmentRecord | null = existing;
  const repositoryCalls: Array<{ kind: string; value?: unknown }> = [];
  const auditEvents: AuditEvent[] = [];
  const repository: DepartmentRepositoryPort = {
    async findVisiblePage() { throw new Error("not used"); },
    async findVisibleById() { throw new Error("not used"); },
    async findActiveParentChain(_executor, branchId) {
      repositoryCalls.push({ kind: "findActiveParentChain", value: branchId });
      return options.parentActive !== false && branchId === "4";
    },
    async findById(_executor, id) {
      repositoryCalls.push({ kind: "findById", value: id });
      return stored?.id === id ? stored : null;
    },
    async insert(_executor, input) {
      repositoryCalls.push({ kind: "insert", value: input });
      stored = { id: "18", ...input, isActive: true, createdAt: fixedNow, updatedAt: fixedNow };
      return stored;
    },
    async update(_executor, id, input) {
      repositoryCalls.push({ kind: "update", value: { id, input } });
      if (!stored || stored.id !== id) return null;
      stored = { ...stored, ...input, updatedAt: fixedNow };
      return stored;
    },
    async deactivate(_executor, id) {
      repositoryCalls.push({ kind: "deactivate", value: id });
      if (options.deactivateRace || !stored || stored.id !== id || !stored.isActive) {
        return null;
      }
      stored = { ...stored, isActive: false, updatedAt: fixedNow };
      return stored;
    },
  };
  const writer: AuditEventWriter = {
    async insert(_executor, event): Promise<AuditReceipt> {
      if (options.auditFailure && event.action.endsWith(".succeeded")) throw options.auditFailure;
      auditEvents.push(event);
      return { id: auditEvents.length, action: event.action, requestId: event.requestId };
    },
  };
  const audit = {
    actions: new ActionObserver({} as DatabaseExecutor, writer, { error() {} }),
    domain: new DomainAuditObserver(writer),
    async queryAuditLogs() { throw new Error("not used"); },
  } satisfies AuditService;
  const transactionRunner: TransactionRunner = {
    async transaction(work) {
      const before = stored;
      try {
        return await work({} as never);
      } catch (error) {
        stored = before;
        throw error;
      }
    },
  };
  return {
    auditEvents,
    repositoryCalls,
    getStored: () => stored,
    service: createDepartmentService({
      repository,
      rootExecutor: {} as DatabaseExecutor,
      transactionRunner,
      audit,
    }),
  };
};

describe("department write request validation", () => {
  test("normalizes create/update values and rejects parent reassignment", () => {
    expect(parseCreateDepartmentRequest({
      branch_id: "4",
      code: "  BAR  ",
      name: "  Beverage  ",
    })).toEqual({ branchId: "4", code: "BAR", name: "Beverage" });
    expect(parseUpdateDepartmentRequest({ name: "  Hot Kitchen  " })).toEqual({
      name: "Hot Kitchen",
    });
    expect(() => parseUpdateDepartmentRequest({ branch_id: "5", name: "Moved" }))
      .toThrowError(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(() => parseUpdateDepartmentRequest({}))
      .toThrowError(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(parseDeactivateDepartmentRequest({ reason: "  Closed floor  " }))
      .toEqual({ reason: "Closed floor" });
    expect(() => parseDeactivateDepartmentRequest({ reason: "   " }))
      .toThrowError(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(() => parseDeactivateDepartmentRequest({ reason: "x".repeat(501) }))
      .toThrowError(expect.objectContaining({ code: "VALIDATION_ERROR" }));
  });
});

describe("department write service", () => {
  test.each(["OWNER", "HR"] as const)("allows %s to create under an active Branch and Shop", async (roleCode) => {
    const fixture = setup();
    const result = await fixture.service.createDepartment({
      actor: actor(roleCode),
      requestId: `department-create-${roleCode}`,
      branchId: "4",
      code: " BAR ",
      name: " Beverage ",
    });
    expect(result).toMatchObject({ id: "18", branchId: "4", code: "BAR", name: "Beverage" });
    expect(fixture.repositoryCalls).toEqual([
      { kind: "findActiveParentChain", value: "4" },
      { kind: "insert", value: { branchId: "4", code: "BAR", name: "Beverage" } },
    ]);
    expect(fixture.auditEvents).toEqual([expect.objectContaining({
      action: "organization.department.create.succeeded",
      tableName: "departments",
      newData: { id: "18", branch_id: "4", code: "BAR", name: "Beverage", is_active: true },
    })]);
  });

  test("updates safe fields without changing branch_id and audits old/new snapshots", async () => {
    const fixture = setup();
    const result = await fixture.service.updateDepartment({
      actor: actor("OWNER"),
      requestId: "department-update",
      id: "17",
      name: " Hot Kitchen ",
    });
    expect(result).toMatchObject({ id: "17", branchId: "4", name: "Hot Kitchen" });
    expect(fixture.repositoryCalls).toEqual([
      { kind: "findById", value: "17" },
      { kind: "findActiveParentChain", value: "4" },
      { kind: "update", value: { id: "17", input: { name: "Hot Kitchen" } } },
    ]);
    expect(fixture.auditEvents[0]).toMatchObject({
      action: "organization.department.update.succeeded",
      oldData: { id: "17", branch_id: "4", name: "Kitchen" },
      newData: { id: "17", branch_id: "4", name: "Hot Kitchen" },
    });
  });

  test("denies scoped writers and rejects inactive parent chains before mutation", async () => {
    const scoped = setup();
    await expect(scoped.service.createDepartment({
      actor: actor("BRANCH_MANAGER"), requestId: "denied", branchId: "4", code: "NO", name: "No",
    })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
    expect(scoped.repositoryCalls).toHaveLength(0);

    const inactive = setup({ parentActive: false });
    await expect(inactive.service.createDepartment({
      actor: actor("OWNER"), requestId: "inactive", branchId: "4", code: "NO", name: "No",
    })).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    expect(inactive.repositoryCalls).toEqual([{ kind: "findActiveParentChain", value: "4" }]);
  });

  test("rolls mutation back when atomic domain audit fails", async () => {
    const failure = new Error("audit unavailable");
    const fixture = setup({ auditFailure: failure });
    const before = fixture.getStored();
    await expect(fixture.service.createDepartment({
      actor: actor("OWNER"), requestId: "rollback", branchId: "4", code: "BAR", name: "Beverage",
    })).rejects.toBe(failure);
    expect(fixture.getStored()).toBe(before);
  });

  test.each(["OWNER", "HR"] as const)("allows %s to deactivate once and audits the supplied reason", async (roleCode) => {
    const fixture = setup();
    const result = await fixture.service.deactivateDepartment({
      actor: actor(roleCode),
      requestId: `department-deactivate-${roleCode}`,
      id: "17",
      reason: "  Floor consolidated  ",
    });
    expect(result).toMatchObject({ id: "17", branchId: "4", isActive: false });
    expect(fixture.repositoryCalls).toEqual([
      { kind: "findById", value: "17" },
      { kind: "deactivate", value: "17" },
    ]);
    expect(fixture.auditEvents[0]).toMatchObject({
      action: "organization.department.deactivate.succeeded",
      reason: "Floor consolidated",
      oldData: { id: "17", branch_id: "4", is_active: true },
      newData: { id: "17", branch_id: "4", is_active: false },
    });
  });

  test("rejects missing, repeated, concurrent, and unauthorized deactivation", async () => {
    const missing = setup();
    await expect(missing.service.deactivateDepartment({
      actor: actor("OWNER"), requestId: "missing", id: "99", reason: "Closed",
    })).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });

    const repeated = setup();
    await repeated.service.deactivateDepartment({
      actor: actor("OWNER"), requestId: "first", id: "17", reason: "Closed",
    });
    await expect(repeated.service.deactivateDepartment({
      actor: actor("OWNER"), requestId: "repeat", id: "17", reason: "Closed",
    })).rejects.toMatchObject({ code: "STATE_CONFLICT" });

    const raced = setup({ deactivateRace: true });
    await expect(raced.service.deactivateDepartment({
      actor: actor("OWNER"), requestId: "race", id: "17", reason: "Closed",
    })).rejects.toMatchObject({ code: "STATE_CONFLICT" });

    const denied = setup();
    await expect(denied.service.deactivateDepartment({
      actor: actor("BRANCH_MANAGER"), requestId: "denied", id: "17", reason: "Closed",
    })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
    expect(denied.repositoryCalls).toHaveLength(0);
  });

  test("rolls deactivation back when its domain audit fails", async () => {
    const failure = new Error("audit unavailable");
    const fixture = setup({ auditFailure: failure });
    await expect(fixture.service.deactivateDepartment({
      actor: actor("OWNER"), requestId: "deactivate-rollback", id: "17", reason: "Closed",
    })).rejects.toBe(failure);
    expect(fixture.getStored()).toMatchObject({ id: "17", isActive: true });
  });
});

describe("department mutation routes", () => {
  test("exposes CSRF-protected create/update/deactivate and rejects invalid bodies", async () => {
    const app = createDepartmentRoutes({
      service: setup().service,
      allowedOrigins: ["http://localhost"],
      async authenticate() { return actor("OWNER"); },
    });
    const headers = { "content-type": "application/json", origin: "http://localhost" };
    const created = await app.handle(new Request("http://localhost/api/v1/departments", {
      method: "POST", headers,
      body: JSON.stringify({ branch_id: "4", code: "BAR", name: "Beverage" }),
    }));
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({ data: { id: "18", branch_id: "4" } });

    const reparent = await app.handle(new Request("http://localhost/api/v1/departments/17", {
      method: "PATCH", headers,
      body: JSON.stringify({ branch_id: "5", name: "Moved" }),
    }));
    expect(reparent.status).toBe(422);
    expect(await reparent.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    const rejected = await app.handle(new Request("http://localhost/api/v1/departments", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ branch_id: "4", code: "NO", name: "No origin" }),
    }));
    expect(rejected.status).toBe(403);
    expect(await rejected.json()).toMatchObject({ error: { code: "ORIGIN_NOT_ALLOWED" } });

    const deactivated = await app.handle(new Request("http://localhost/api/v1/departments/18/deactivate", {
      method: "POST", headers,
      body: JSON.stringify({ reason: " Consolidated " }),
    }));
    expect(deactivated.status).toBe(200);
    expect(await deactivated.json()).toMatchObject({ data: { id: "18", is_active: false } });

    const unknown = await app.handle(new Request("http://localhost/api/v1/departments/18/deactivate", {
      method: "POST", headers,
      body: JSON.stringify({ reason: "Closed", extra: true }),
    }));
    expect(unknown.status).toBe(422);

    const whitespace = await app.handle(new Request("http://localhost/api/v1/departments/18/deactivate", {
      method: "POST", headers,
      body: JSON.stringify({ reason: "   " }),
    }));
    expect(whitespace.status).toBe(422);
  });
});

const databaseTest = process.env.A2_DATABASE_INTEGRATION === "1" ? test : test.skip;

describe("department repository database writes", () => {
  databaseTest("requires an active Branch and Shop and maps same-branch duplicate codes", async () => {
    const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
    await expect(db.transaction(async (executor) => {
      const [shop] = await executor.insert(shops).values({ code: `DW${suffix}`, name: "Department write shop" }).returning();
      const [branch] = await executor.insert(branches).values({ shopId: shop!.id, code: `B${suffix}`, name: "Branch" }).returning();
      expect(await departmentRepository.findActiveParentChain(executor, String(branch!.id))).toBe(true);

      const first = await departmentRepository.insert(executor, {
        branchId: String(branch!.id), code: `D${suffix}`, name: "First",
      });
      expect(first.branchId).toBe(String(branch!.id));
      expect(await departmentRepository.update(executor, first.id, { name: "Updated" }))
        .toMatchObject({ name: "Updated" });

      expect(await departmentRepository.deactivate(executor, first.id))
        .toMatchObject({ id: first.id, isActive: false });
      expect(await departmentRepository.deactivate(executor, first.id)).toBeNull();

      await executor.update(shops).set({ isActive: false }).where(eq(shops.id, shop!.id));
      expect(await departmentRepository.findActiveParentChain(executor, String(branch!.id))).toBe(false);
      await executor.update(shops).set({ isActive: true }).where(eq(shops.id, shop!.id));

      await departmentRepository.insert(executor, {
        branchId: String(branch!.id), code: `D${suffix}`, name: "Duplicate",
      });
    })).rejects.toMatchObject({ code: "DUPLICATE_CODE" });

    expect(await db.select().from(departments).where(eq(departments.code, `D${suffix}`))).toHaveLength(0);
  });
});

afterAll(async () => {
  if (process.env.A2_DATABASE_INTEGRATION === "1") await closeDatabase();
});
