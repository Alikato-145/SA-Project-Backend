import { describe, expect, test } from "bun:test";
import { ActionObserver } from "../../core/audit/action-observer";
import { DomainAuditObserver } from "../../core/audit/domain-audit-observer";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { DatabaseExecutor, TransactionRunner } from "../../core/db/transaction";
import type { AuditEvent, AuditReceipt } from "../audit/audit.repository";
import type { EmployeeWriteInput, EmployeeWriteRepositoryPort } from "./employee.repository";
import { createEmployeeService } from "./employee.service";

const actor = (roleCode: "OWNER" | "HR" | "SUPERVISOR"): AuthenticatedActor => ({
  accountId: "9", employeeId: null, username: "admin",
  grants: [{ grantId: "1", roleCode, scope: roleCode === "SUPERVISOR" ? "department" : "all", branchId: roleCode === "SUPERVISOR" ? "1" : null, departmentId: roleCode === "SUPERVISOR" ? "2" : null }],
});

type Row = EmployeeWriteInput & { id: string; status: "active" | "inactive" | "suspended" | "terminated"; terminatedAt: string | null };
type MemoryExecutor = { rows: Row[] };
const record = (row: Row) => ({ ...row, currentAssignment: null });

const setup = (options: { failSuccessAudit?: boolean } = {}) => {
  const root: MemoryExecutor = { rows: [] };
  const events: AuditEvent[] = [];
  const repository: EmployeeWriteRepositoryPort = {
    async list() { return { items: [], page: 1, pageSize: 20, total: 0 }; },
    async findById(executor, id) { const row = (executor as unknown as MemoryExecutor).rows.find((item) => item.id === id); return row ? record(row) : null; },
    async findIdentityConflict(executor, input, excludeId) {
      const row = (executor as unknown as MemoryExecutor).rows.find((item) => item.id !== excludeId && (item.employeeCode === input.employeeCode || (!!input.nationalId && item.nationalId === input.nationalId) || (!!input.passportId && item.passportId === input.passportId)));
      return row ? { id: row.id } : null;
    },
    async insert(executor, input) { const row: Row = { ...input, id: String((executor as unknown as MemoryExecutor).rows.length + 1), status: "active", terminatedAt: null }; (executor as unknown as MemoryExecutor).rows.push(row); return record(row); },
    async updateIdentity(executor, id, input) { const row = (executor as unknown as MemoryExecutor).rows.find((item) => item.id === id); if (!row) return null; Object.assign(row, input); return record(row); },
    async updateStatus(executor, id, status, terminatedAt) { const row = (executor as unknown as MemoryExecutor).rows.find((item) => item.id === id); if (!row) return null; row.status = status; row.terminatedAt = terminatedAt; return record(row); },
  };
  const transactionRunner: TransactionRunner = {
    async transaction(work) {
      const staged: MemoryExecutor = { rows: structuredClone(root.rows) };
      const value = await work(staged as unknown as never);
      root.rows = staged.rows;
      return value;
    },
  };
  const writer = {
    async insert(_executor: DatabaseExecutor, event: AuditEvent): Promise<AuditReceipt> {
      if (options.failSuccessAudit && event.action.endsWith(".succeeded")) throw new Error("audit down");
      events.push(event);
      return { id: events.length, action: event.action, requestId: event.requestId };
    },
  };
  const actions = new ActionObserver(root as unknown as DatabaseExecutor, writer, { error() {} });
  const service = createEmployeeService({ rootExecutor: root as unknown as DatabaseExecutor, repository, writeRepository: repository, transactionRunner, actions, domain: new DomainAuditObserver(writer), today: () => "2026-09-27" });
  return { service, root, events };
};

const valid = { employeeCode: "E001", nationalId: "1234567890123", passportId: null, firstName: "Ada", lastName: "Lovelace", phone: null, personalEmail: null, address: null, hireDate: "2026-01-01" };

describe("A3 employee writes", () => {
  test("HR and Owner create an active employee with one atomic redacted audit", async () => {
    for (const role of ["HR", "OWNER"] as const) {
      const { service, root, events } = setup();
      const created = await service.createEmployee({ actor: actor(role), requestId: `create-${role}`, ...valid });
      expect(created.record).toMatchObject({ employeeCode: "E001", status: "active" });
      expect(root.rows).toHaveLength(1);
      expect(events).toHaveLength(1);
      expect(JSON.stringify(events)).not.toContain(valid.nationalId);
    }
  });

  test("rejects scoped writers, missing identity, duplicates, and invalid dates", async () => {
    const { service } = setup();
    await expect(service.createEmployee({ actor: actor("SUPERVISOR"), requestId: "deny", ...valid })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
    await expect(service.createEmployee({ actor: actor("HR"), requestId: "identity", ...valid, nationalId: null })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await service.createEmployee({ actor: actor("HR"), requestId: "first", ...valid });
    await expect(service.createEmployee({ actor: actor("HR"), requestId: "duplicate", ...valid })).rejects.toMatchObject({ code: "DUPLICATE_IDENTITY" });
  });

  test("updates safe fields but keeps employee code and hire date immutable", async () => {
    const { service } = setup();
    const created = await service.createEmployee({ actor: actor("OWNER"), requestId: "create", ...valid });
    const updated = await service.updateEmployee({ actor: actor("HR"), requestId: "update", employeeId: created.record.id, firstName: "Grace", passportId: "P123", nationalId: null });
    expect(updated.record).toMatchObject({ employeeCode: "E001", hireDate: "2026-01-01", firstName: "Grace", nationalId: null, passportId: "P123" });
  });

  test("termination preserves the row and requires date on or after hire date", async () => {
    const { service, root } = setup();
    const created = await service.createEmployee({ actor: actor("HR"), requestId: "create", ...valid });
    await expect(service.changeEmployeeStatus({ actor: actor("HR"), requestId: "bad-date", employeeId: created.record.id, status: "terminated", terminatedAt: "2025-12-31", reason: "left" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const terminated = await service.changeEmployeeStatus({ actor: actor("HR"), requestId: "terminate", employeeId: created.record.id, status: "terminated", terminatedAt: "2026-09-27", reason: "left" });
    expect(terminated.record).toMatchObject({ status: "terminated", terminatedAt: "2026-09-27" });
    expect(root.rows).toHaveLength(1);
  });

  test("audit failure rolls back employee creation", async () => {
    const { service, root } = setup({ failSuccessAudit: true });
    await expect(service.createEmployee({ actor: actor("HR"), requestId: "rollback", ...valid })).rejects.toThrow("audit down");
    expect(root.rows).toHaveLength(0);
  });
});
