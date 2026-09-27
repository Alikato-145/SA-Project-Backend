import { describe, expect, test } from "bun:test";
import { ActionObserver } from "../../core/audit/action-observer";
import { DomainAuditObserver } from "../../core/audit/domain-audit-observer";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { AuditEvent, AuditEventWriter } from "../audit/audit.repository";
import type { AuditService } from "../audit/audit.service";
import type { BranchRepositoryPort } from "../branch/branch.repository";
import { createBranchService } from "../branch/branch.service";
import type { DepartmentRepositoryPort } from "../department/department.repository";
import { createDepartmentService } from "../department/department.service";
import type { PositionRepositoryPort } from "../position/position.repository";
import { createPositionService } from "../position/position.service";
import type { ShopRepositoryPort } from "../shop/shop.repository";
import { createShopService } from "../shop/shop.service";
import type {
  BranchRecord,
  DepartmentRecord,
  PositionRecord,
  ShopRecord,
} from "./organization.types";

const now = new Date("2026-09-22T00:00:00.000Z");
const owner: AuthenticatedActor = {
  accountId: "1",
  employeeId: null,
  username: "owner",
  grants: [{
    grantId: "1", roleCode: "OWNER", scope: "all",
    branchId: null, departmentId: null,
  }],
};
const manager: AuthenticatedActor = {
  accountId: "2",
  employeeId: null,
  username: "manager",
  grants: [{
    grantId: "2", roleCode: "BRANCH_MANAGER", scope: "branch",
    branchId: "2", departmentId: null,
  }],
};

interface DeactivationFixture {
  events: AuditEvent[];
  run(actor: AuthenticatedActor, reason: unknown): Promise<{ isActive: boolean }>;
}

const auditFixture = () => {
  const events: AuditEvent[] = [];
  const writer: AuditEventWriter = {
    async insert(_executor, event) {
      events.push(event);
      return { id: events.length, action: event.action, requestId: event.requestId };
    },
  };
  return {
    events,
    audit: {
      actions: new ActionObserver({} as never, writer),
      domain: new DomainAuditObserver(writer),
      async queryAuditLogs() { throw new Error("not used"); },
    } satisfies AuditService,
  };
};

const transactionRunner = {
  async transaction<T>(work: (executor: never) => Promise<T>): Promise<T> {
    return work({} as never);
  },
};

const shopFixture = (): DeactivationFixture => {
  let record: ShopRecord = {
    id: "1", code: "SHOP", name: "Shop", isActive: true,
    createdAt: now, updatedAt: now,
  };
  const observed = auditFixture();
  const repository = {
    async findById() { return record; },
    async deactivate() {
      if (!record.isActive) return null;
      record = { ...record, isActive: false };
      return record;
    },
  } as unknown as ShopRepositoryPort;
  const service = createShopService({
    repository, rootExecutor: {} as never, transactionRunner, audit: observed.audit,
  });
  return {
    events: observed.events,
    run: (actor, reason) => service.deactivateShop({
      actor, reason, requestId: "deactivate-shop", shopId: record.id,
    }),
  };
};

const branchFixture = (): DeactivationFixture => {
  let record: BranchRecord = {
    id: "2", shopId: "1", code: "BR", name: "Branch", address: null,
    timezone: "Asia/Bangkok", isActive: true, createdAt: now, updatedAt: now,
  };
  const observed = auditFixture();
  const repository = {
    async findById() { return record; },
    async deactivate() {
      if (!record.isActive) return null;
      record = { ...record, isActive: false };
      return record;
    },
  } as unknown as BranchRepositoryPort;
  const service = createBranchService({
    repository, rootExecutor: {} as never, transactionRunner, audit: observed.audit,
  });
  return {
    events: observed.events,
    run: (actor, reason) => service.deactivateBranch({
      actor, reason, requestId: "deactivate-branch", id: record.id,
    }),
  };
};

const departmentFixture = (): DeactivationFixture => {
  let record: DepartmentRecord = {
    id: "3", branchId: "2", code: "DEPT", name: "Department", isActive: true,
    createdAt: now, updatedAt: now,
  };
  const observed = auditFixture();
  const repository = {
    async findById() { return record; },
    async deactivate() {
      if (!record.isActive) return null;
      record = { ...record, isActive: false };
      return record;
    },
  } as unknown as DepartmentRepositoryPort;
  const service = createDepartmentService({
    repository, rootExecutor: {} as never, transactionRunner, audit: observed.audit,
  });
  return {
    events: observed.events,
    run: (actor, reason) => service.deactivateDepartment({
      actor, reason, requestId: "deactivate-department", id: record.id,
    }),
  };
};

const positionFixture = (): DeactivationFixture => {
  let record: PositionRecord = {
    id: "4", shopId: "1", code: "POS", name: "Position", isActive: true,
    createdAt: now, updatedAt: now,
  };
  const observed = auditFixture();
  const repository = {
    async findById() { return record; },
    async deactivate() {
      if (!record.isActive) return null;
      record = { ...record, isActive: false };
      return record;
    },
  } as unknown as PositionRepositoryPort;
  const service = createPositionService({
    repository, rootExecutor: {} as never, transactionRunner, audit: observed.audit,
  });
  return {
    events: observed.events,
    run: (actor, reason) => service.deactivatePosition({
      actor, reason, requestId: "deactivate-position", id: record.id,
    }),
  };
};

const resources = [
  ["shop", shopFixture],
  ["branch", branchFixture],
  ["department", departmentFixture],
  ["position", positionFixture],
] as const;

describe("organization resource deactivation services", () => {
  test.each(resources)("deactivates %s once and preserves the trimmed reason", async (name, setup) => {
    const fixture = setup();
    expect(await fixture.run(owner, "  Historical closure  ")).toMatchObject({ isActive: false });
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0]).toMatchObject({
      action: `organization.${name}.deactivate.succeeded`,
      reason: "Historical closure",
      oldData: { is_active: true },
      newData: { is_active: false },
    });
    await expect(fixture.run(owner, "Again")).rejects.toMatchObject({ code: "STATE_CONFLICT" });
  });

  test.each(resources)("denies scoped writers from deactivating %s", async (_name, setup) => {
    const fixture = setup();
    await expect(fixture.run(manager, "Not allowed"))
      .rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0]?.reason).toBe("FORBIDDEN_SCOPE");
  });
});
