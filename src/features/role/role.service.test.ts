import { describe, expect, test } from "bun:test";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { ApplicationError } from "../../core/errors/application.error";
import { ActionObserver } from "../../core/audit/action-observer";
import { DomainAuditObserver } from "../../core/audit/domain-audit-observer";
import type { AuditReceipt } from "../audit/audit.repository";
import type { AuditService } from "../audit/audit.service";
import {
  createRoleService,
  type RoleRepositoryPort,
} from "./role.service";

const owner: AuthenticatedActor = {
  accountId: "1",
  employeeId: null,
  username: "owner",
  grants: [{ grantId: "1", roleCode: "OWNER", scope: "all", branchId: null, departmentId: null }],
};
const hr: AuthenticatedActor = {
  accountId: "2",
  employeeId: "22",
  username: "hr",
  grants: [{ grantId: "2", roleCode: "HR", scope: "all", branchId: null, departmentId: null }],
};

const roleRecord = (code: "EMPLOYEE" | "SUPERVISOR" | "BRANCH_MANAGER" | "HR" | "OWNER") => {
  const scopes = { EMPLOYEE: "self", SUPERVISOR: "department", BRANCH_MANAGER: "branch", HR: "all", OWNER: "all" } as const;
  return { id: code === "OWNER" ? "5" : "2", code, name: code, scope: scopes[code], isActive: true };
};

const setup = (override: Partial<RoleRepositoryPort> = {}) => {
  const events: { action: string; outcome: string; newData?: unknown }[] = [];
  let deleted = false;
  const repository: RoleRepositoryPort = {
    async listCatalog() {
      return [{ id: "1", code: "EMPLOYEE", name: "Employee", scope: "self", isActive: true }];
    },
    async findRoleByCode(_executor, code) {
      return roleRecord(code);
    },
    async findAccount() { return { id: "9", employeeId: "99", status: "active" }; },
    async branchExists() { return true; },
    async departmentBelongsToBranch() { return true; },
    async findDuplicateGrant() { return null; },
    async insertGrant(_executor, input) {
      return { id: "31", ...input, grantedAt: new Date("2026-09-22T00:00:00.000Z") };
    },
    async findGrantForAccount() {
      return { id: "31", userAccountId: "9", roleId: "2", roleCode: "SUPERVISOR", roleScope: "department", roleActive: true, branchId: "7", departmentId: "8" };
    },
    async countActiveOwnerAccounts() { return 2; },
    async deleteGrant() { deleted = true; },
    ...override,
  };

  const writer = {
    async insert(_executor: never, event: { action: string; requestId: string; newData?: unknown }): Promise<AuditReceipt> {
      events.push({ action: event.action.replace(/\.(?:succeeded|failed)$/, ""), outcome: event.action.endsWith(".failed") ? "failed" : "succeeded", newData: event.newData });
      return { id: events.length, action: event.action, requestId: event.requestId };
    },
  };
  const service = createRoleService({
    repository,
    rootExecutor: {} as never,
    transactionRunner: { async transaction(work) { return work({} as never); } },
    audit: {
      actions: new ActionObserver({} as never, writer as never),
      domain: new DomainAuditObserver(writer as never),
      async queryAuditLogs() { throw new Error("not used"); },
    } satisfies AuditService,
  });
  return { service, events, wasDeleted: () => deleted };
};

const grant = (actor = owner) => ({
  actor,
  accountId: "9",
  roleCode: "SUPERVISOR" as const,
  branchId: "7",
  departmentId: "8",
  reason: "Promotion",
  requestId: "req-role",
});

describe("fixed-role administration service", () => {
  test("lists the fixed catalog for HR or Owner and denies non-administrators", async () => {
    const { service } = setup();
    expect(await service.listRoles({ actor: hr, requestId: "req-role" })).toHaveLength(1);
    await expect(service.listRoles({ actor: { ...hr, grants: [] }, requestId: "req-role" })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
  });

  test("grants a valid department scope transactionally with audit evidence", async () => {
    const { service, events } = setup();
    const result = await service.grantRole(grant());
    expect(result).toMatchObject({ id: "31", roleCode: "SUPERVISOR", branchId: "7", departmentId: "8" });
    expect(events).toEqual([{ action: "role.grant.create", outcome: "succeeded", newData: expect.objectContaining({ id: "31" }) }]);
  });

  test("rejects every invalid scope shape", async () => {
    const { service } = setup();
    for (const command of [
      { ...grant(), branchId: null },
      { ...grant(), departmentId: null },
      { ...grant(), roleCode: "BRANCH_MANAGER" as const, departmentId: "8" },
      { ...grant(), roleCode: "HR" as const, branchId: "7", departmentId: null },
      { ...grant(), roleCode: "EMPLOYEE" as const, branchId: "7", departmentId: null },
    ]) {
      await expect(service.grantRole(command)).rejects.toMatchObject({ code: "INVALID_ROLE_SCOPE" });
    }
  });

  test("rejects mismatched organization, duplicates, and inactive roles", async () => {
    await expect(setup({ async departmentBelongsToBranch() { return false; } }).service.grantRole(grant())).rejects.toMatchObject({ code: "INVALID_ORGANIZATION_RELATION" });
    await expect(setup({ async findDuplicateGrant() { return { id: "44" }; } }).service.grantRole(grant())).rejects.toMatchObject({ code: "DUPLICATE_ROLE_GRANT" });
    await expect(setup({ async findRoleByCode(_executor, code) { return { ...roleRecord(code), isActive: false }; } }).service.grantRole(grant())).rejects.toMatchObject({ code: "STATE_CONFLICT" });
  });

  test("prevents HR granting Owner and any caller granting beyond current scope", async () => {
    await expect(setup().service.grantRole({ ...grant(hr), roleCode: "OWNER", branchId: null, departmentId: null })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
    const branchManager: AuthenticatedActor = { ...hr, grants: [{ grantId: "3", roleCode: "BRANCH_MANAGER", scope: "branch", branchId: "7", departmentId: null }] };
    await expect(setup().service.grantRole({ ...grant(branchManager), branchId: "10" })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
  });

  test("revokes only a grant belonging to the account and preserves the final active Owner", async () => {
    const absent = setup({ async findGrantForAccount() { return null; } });
    await expect(absent.service.revokeRole({ actor: owner, accountId: "9", grantId: "31", reason: "Wrong account", requestId: "req-role" })).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });

    const finalOwner = setup({
      async findGrantForAccount() { return { id: "31", userAccountId: "9", roleId: "5", roleCode: "OWNER", roleScope: "all", roleActive: true, branchId: null, departmentId: null }; },
      async countActiveOwnerAccounts() { return 1; },
    });
    await expect(finalOwner.service.revokeRole({ actor: owner, accountId: "9", grantId: "31", reason: "No", requestId: "req-role" })).rejects.toMatchObject({ code: "STATE_CONFLICT" });

    const valid = setup();
    await valid.service.revokeRole({ actor: owner, accountId: "9", grantId: "31", reason: "Transfer", requestId: "req-role" });
    expect(valid.wasDeleted()).toBe(true);
  });
});

test("public errors remain typed", () => {
  expect(new ApplicationError("DUPLICATE_ROLE_GRANT").status).toBe(409);
});
