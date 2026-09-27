import { describe, expect, test } from "bun:test";
import { ActionObserver } from "../../core/audit/action-observer";
import { DomainAuditObserver } from "../../core/audit/domain-audit-observer";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { AuditReceipt } from "../audit/audit.repository";
import type { AuditService } from "../audit/audit.service";
import type {
  AdminAccountRecord,
  UserAccountAdminRepository,
} from "./user-account.admin.repository";
import { createUserAccountAdminService } from "./user-account.admin.service";

const owner: AuthenticatedActor = {
  accountId: "1", employeeId: null, username: "owner",
  grants: [{ grantId: "1", roleCode: "OWNER", scope: "all", branchId: null, departmentId: null }],
};

const account = (overrides: Partial<AdminAccountRecord> = {}): AdminAccountRecord => ({
  id: "9", employeeId: "45", employeeCode: "EMP-045",
  employeeFirstName: "Mana", employeeLastName: "Example", username: "mana",
  status: "active", failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: null,
  createdAt: new Date("2026-09-22T00:00:00.000Z"),
  updatedAt: new Date("2026-09-22T00:00:00.000Z"), ...overrides,
});

const setup = (overrides: Partial<UserAccountAdminRepository> = {}) => {
  let current = account();
  let storedHash = "";
  const events: { action: string; newData?: unknown; oldData?: unknown }[] = [];
  const repository: UserAccountAdminRepository = {
    async list() { return { records: [current], total: 1 }; },
    async findById() { return current; },
    async findByUsername() { return null; },
    async findByEmployeeId() { return null; },
    async employeeExists() { return true; },
    async insert(_executor, input) {
      storedHash = input.passwordHash;
      current = account({ username: input.username, employeeId: input.employeeId });
      return current;
    },
    async updateStatus(_executor, _id, status) { current = account({ ...current, status }); return current; },
    async updatePassword(_executor, _id, hash) { storedHash = hash; current = account({ ...current, status: "active", failedLoginAttempts: 0, lockedUntil: null }); return current; },
    async unlock() { current = account({ ...current, status: "active", failedLoginAttempts: 0, lockedUntil: null }); return current; },
    async findActiveGrants() { return []; },
    async hasActiveOwnerGrant() { return false; },
    async countActiveOwnerAccounts() { return 2; },
    ...overrides,
  };
  const writer = {
    async insert(_executor: never, event: { action: string; requestId: string; newData?: unknown; oldData?: unknown }): Promise<AuditReceipt> {
      events.push({ action: event.action, newData: event.newData, oldData: event.oldData });
      return { id: events.length, action: event.action, requestId: event.requestId };
    },
  };
  const audit = {
    actions: new ActionObserver({} as never, writer as never),
    domain: new DomainAuditObserver(writer as never),
    async queryAuditLogs() { throw new Error("not used"); },
  } satisfies AuditService;
  const service = createUserAccountAdminService({
    repository, rootExecutor: {} as never,
    transactionRunner: { async transaction(work) { return work({} as never); } },
    audit,
    temporaryPasswordGenerator: () => "Temp!OnlyOnce-123456",
    passwordHasher: async (value) => `argon:${value.length}`,
  });
  return { service, events, storedHash: () => storedHash };
};

describe("user-account administration", () => {
  test("creates an employee-linked account and returns a temporary password only in the result", async () => {
    const { service, events, storedHash } = setup();
    const result = await service.createAccount({
      actor: owner, requestId: "req-account", username: "mana", employeeId: "45",
    });
    expect(result.temporaryPassword).toBe("Temp!OnlyOnce-123456");
    expect(storedHash()).toBe("argon:20");
    expect(JSON.stringify(events)).not.toContain("Temp!OnlyOnce-123456");
    expect(JSON.stringify(events)).not.toContain("argon:20");
    expect(events).toHaveLength(1);
  });

  test("rejects duplicate usernames and employee links with stable codes", async () => {
    await expect(setup({ async findByUsername() { return { id: "8" }; } }).service.createAccount({
      actor: owner, requestId: "req", username: "mana", employeeId: null,
    })).rejects.toMatchObject({ code: "DUPLICATE_USERNAME" });
    await expect(setup({ async findByEmployeeId() { return { id: "8" }; } }).service.createAccount({
      actor: owner, requestId: "req", username: "new.user", employeeId: "45",
    })).rejects.toMatchObject({ code: "EMPLOYEE_ACCOUNT_ALREADY_EXISTS" });
  });

  test("prevents disabling the final active Owner", async () => {
    const { service } = setup({
      async hasActiveOwnerGrant() { return true; },
      async countActiveOwnerAccounts() { return 1; },
    });
    await expect(service.changeStatus({
      actor: owner, requestId: "req", accountId: "9", status: "disabled", reason: "No",
    })).rejects.toMatchObject({ code: "STATE_CONFLICT" });
  });

  test("resets an active password without exposing it to audit", async () => {
    const { service, events } = setup();
    const result = await service.resetPassword({ actor: owner, requestId: "req", accountId: "9", reason: "Verified" });
    expect(result.temporaryPassword).toBe("Temp!OnlyOnce-123456");
    expect(JSON.stringify(events)).not.toContain(result.temporaryPassword);
  });

  test("unlocks only temporarily locked accounts and never enables disabled accounts", async () => {
    const locked = setup({ async findById() { return account({ status: "locked", failedLoginAttempts: 5, lockedUntil: new Date("2026-09-22T01:00:00Z") }); } });
    expect((await locked.service.unlockAccount({ actor: owner, requestId: "req", accountId: "9", reason: "Verified" })).account.status).toBe("active");
    const disabled = setup({ async findById() { return account({ status: "disabled" }); } });
    await expect(disabled.service.unlockAccount({ actor: owner, requestId: "req", accountId: "9", reason: "No" })).rejects.toMatchObject({ code: "STATE_CONFLICT" });
  });

  test("requires an HR or Owner all-scope grant for every administration action", async () => {
    const employee = { ...owner, grants: [{ grantId: "2", roleCode: "EMPLOYEE" as const, scope: "self" as const, branchId: null, departmentId: null }] };
    await expect(setup().service.listAccounts({ actor: employee, requestId: "req", query: { page: 1, pageSize: 20 } })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
  });
});
