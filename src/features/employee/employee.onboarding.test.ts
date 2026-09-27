import { describe, expect, test } from "bun:test";
import { ActionObserver } from "../../core/audit/action-observer";
import { DomainAuditObserver } from "../../core/audit/domain-audit-observer";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { DatabaseExecutor, TransactionRunner } from "../../core/db/transaction";
import type { AuditEvent, AuditReceipt } from "../audit/audit.repository";
import type { EmployeeWriteInput, EmployeeWriteRepositoryPort } from "./employee.repository";
import { toEmployeeOnboardingResponseDto } from "./employee.mapper";
import { createEmployeeService } from "./employee.service";

type FailureStage = "assignment" | "bank" | "holiday" | "account" | "audit";
type EmployeeRow = EmployeeWriteInput & {
  id: string;
  status: "active";
  terminatedAt: null;
};
interface MemoryState {
  employees: EmployeeRow[];
  assignments: string[];
  banks: string[];
  holidays: string[];
  accounts: string[];
  events: AuditEvent[];
}

const owner: AuthenticatedActor = {
  accountId: "1",
  employeeId: null,
  username: "owner",
  grants: [{
    grantId: "1",
    roleCode: "OWNER",
    scope: "all",
    branchId: null,
    departmentId: null,
  }],
};

const employee = {
  employeeCode: "E100",
  nationalId: "1234567890123",
  passportId: null,
  firstName: "Ada",
  lastName: "Lovelace",
  phone: null,
  personalEmail: "ada@example.test",
  address: null,
  hireDate: "2026-09-01",
};

const command = {
  actor: owner,
  requestId: "onboard-1",
  employee,
  assignment: {
    branchId: "10",
    departmentId: "20",
    positionId: "30",
    employmentType: "full_time" as const,
    baseSalary: "25000.00",
    welfareAmount: "1500.00",
    effectiveFrom: "2026-09-01",
    effectiveTo: null,
  },
  bankAccount: {
    bankCode: "KBANK",
    bankName: "Kasikornbank",
    accountHolderName: "Ada Lovelace",
    accountNumber: "1234567890",
    isPrimary: true,
  },
  weeklyHolidays: [
    { weekday: 0, effectiveFrom: "2026-09-01", effectiveTo: null },
    { weekday: 6, effectiveFrom: "2026-09-01", effectiveTo: null },
  ],
  account: { username: "ada.lovelace" },
};

const setup = (failure?: FailureStage) => {
  const root: MemoryState = {
    employees: [],
    assignments: [],
    banks: [],
    holidays: [],
    accounts: [],
    events: [],
  };
  const repository: EmployeeWriteRepositoryPort = {
    async list() {
      return { items: [], page: 1, pageSize: 20, total: 0 };
    },
    async findById(executor, id) {
      const row = (executor as unknown as MemoryState).employees.find((item) => item.id === id);
      return row ? { ...row, currentAssignment: null } : null;
    },
    async findIdentityConflict(executor, input) {
      const row = (executor as unknown as MemoryState).employees.find((item) =>
        item.employeeCode === input.employeeCode ||
        (!!input.nationalId && item.nationalId === input.nationalId) ||
        (!!input.passportId && item.passportId === input.passportId));
      return row ? { id: row.id } : null;
    },
    async insert(executor, input) {
      const state = executor as unknown as MemoryState;
      const row: EmployeeRow = {
        ...input,
        id: String(state.employees.length + 1),
        status: "active",
        terminatedAt: null,
      };
      state.employees.push(row);
      return { ...row, currentAssignment: null };
    },
    async updateIdentity() {
      throw new Error("not used");
    },
    async updateStatus() {
      throw new Error("not used");
    },
  };
  const transactionRunner: TransactionRunner = {
    async transaction(work) {
      const staged = structuredClone(root);
      const result = await work(staged as unknown as never);
      Object.assign(root, staged);
      return result;
    },
  };
  const writer = {
    async insert(executor: DatabaseExecutor, event: AuditEvent): Promise<AuditReceipt> {
      if (failure === "audit" && event.action.endsWith(".succeeded")) {
        throw new Error("audit unavailable");
      }
      const state = executor as unknown as MemoryState;
      state.events.push(event);
      return { id: state.events.length, action: event.action, requestId: event.requestId };
    },
  };
  const fail = (stage: Exclude<FailureStage, "audit">) => {
    if (failure === stage) throw new Error(stage + " failed");
  };
  const actions = new ActionObserver(root as unknown as DatabaseExecutor, writer, { error() {} });
  const service = createEmployeeService({
    rootExecutor: root as unknown as DatabaseExecutor,
    repository,
    writeRepository: repository,
    transactionRunner,
    actions,
    domain: new DomainAuditObserver(writer),
    onboarding: {
      assignment: {
        async createAssignmentInTransaction(executor) {
          fail("assignment");
          const state = executor as unknown as MemoryState;
          state.assignments.push("11");
          return { id: "11" };
        },
      },
      bank: {
        async addBankAccountInTransaction(executor) {
          fail("bank");
          const state = executor as unknown as MemoryState;
          state.banks.push("12");
          return { id: "12" };
        },
      },
      holiday: {
        async addHolidayInTransaction(executor) {
          fail("holiday");
          const state = executor as unknown as MemoryState;
          const id = String(20 + state.holidays.length);
          state.holidays.push(id);
          return { id };
        },
      },
      account: {
        async createAccountInTransaction(executor) {
          fail("account");
          const state = executor as unknown as MemoryState;
          state.accounts.push("13");
          return { account: { id: "13" }, temporaryPassword: "Secret-once-123!" };
        },
      },
    },
  });
  return { root, service };
};

describe("A3 employee onboarding", () => {
  test("commits all selected components and returns a one-time credential", async () => {
    const { root, service } = setup();
    const result = await service.onboardEmployee(command);

    expect(result).toMatchObject({
      assignmentId: "11",
      bankAccountId: "12",
      holidayIds: ["20", "21"],
      accountId: "13",
      temporaryPassword: "Secret-once-123!",
    });
    expect(root.employees).toHaveLength(1);
    expect(root.assignments).toEqual(["11"]);
    expect(root.banks).toEqual(["12"]);
    expect(root.holidays).toEqual(["20", "21"]);
    expect(root.accounts).toEqual(["13"]);
    expect(root.events.map((event) => event.action)).toEqual(["employee.profile.onboard.succeeded"]);

    const auditJson = JSON.stringify(root.events);
    expect(auditJson).not.toContain(command.bankAccount.accountNumber);
    expect(auditJson).not.toContain(result.temporaryPassword);
    expect(auditJson).not.toContain(employee.nationalId);
  });

  test("omits the one-time password field when no account is selected", async () => {
    const { service } = setup();
    const result = await service.onboardEmployee({
      ...command,
      account: undefined,
    });
    const response = toEmployeeOnboardingResponseDto(result);
    expect(response.account_id).toBeNull();
    expect("temporary_password" in response).toBe(false);
  });

  for (const stage of ["assignment", "bank", "holiday", "account", "audit"] as const) {
    test("rolls back every component when " + stage + " fails and records one failed outcome", async () => {
      const { root, service } = setup(stage);
      await expect(service.onboardEmployee(command)).rejects.toThrow();

      expect(root.employees).toHaveLength(0);
      expect(root.assignments).toHaveLength(0);
      expect(root.banks).toHaveLength(0);
      expect(root.holidays).toHaveLength(0);
      expect(root.accounts).toHaveLength(0);
      expect(root.events.map((event) => event.action)).toEqual(["employee.profile.onboard.failed"]);
      expect(JSON.stringify(root.events)).not.toContain(command.bankAccount.accountNumber);
      expect(JSON.stringify(root.events)).not.toContain("Secret-once-123!");
    });
  }
});
