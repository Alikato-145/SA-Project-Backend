import { describe, expect, test } from "bun:test";
import { ActionObserver } from "../../core/audit/action-observer";
import { DomainAuditObserver } from "../../core/audit/domain-audit-observer";
import type {
  AuditEvent,
  AuditEventWriter,
  AuditReceipt,
} from "../audit/audit.repository";
import type { SessionClaims } from "../../core/auth/auth.types";
import type { SessionTokenService } from "../../core/auth/session-token";
import type {
  DatabaseExecutor,
  DatabaseTransaction,
  TransactionRunner,
} from "../../core/db/transaction";
import { ApplicationError } from "../../core/errors/application.error";
import type {
  ActiveGrantRecord,
  AuthenticationAccountRecord,
  CurrentActorAccountRecord,
  FailedLoginUpdate,
  SuccessfulLoginUpdate,
} from "./user-account.repository";
import { createUserAccountService } from "./user-account.service";

const testTime = new Date("2026-09-22T03:00:00.000Z");
const rootExecutor = {} as DatabaseExecutor;
const transactionExecutor = {} as DatabaseTransaction;

class MemoryWriter implements AuditEventWriter {
  readonly events: AuditEvent[] = [];

  async insert(
    _executor: DatabaseExecutor,
    event: AuditEvent,
  ): Promise<AuditReceipt> {
    this.events.push(event);
    return {
      id: this.events.length,
      action: event.action,
      requestId: event.requestId,
    };
  }
}

class SerializedTransactionRunner implements TransactionRunner {
  private tail: Promise<unknown> = Promise.resolve();

  transaction<T>(
    work: (executor: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    const result = this.tail.then(() => work(transactionExecutor));
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

class MemoryUserAccountRepository {
  account: AuthenticationAccountRecord | null;
  grants: ActiveGrantRecord[] = [
    {
      id: 20,
      roleCode: "SUPERVISOR",
      scope: "department",
      branchId: 2,
      departmentId: 8,
    },
  ];
  rowLockReads = 0;

  constructor(
    account: Partial<AuthenticationAccountRecord> | null = {},
  ) {
    this.account =
      account === null
        ? null
        : {
            id: 12,
            employeeId: 45,
            username: "mana",
            passwordHash: "stored-hash",
            status: "active",
            failedLoginAttempts: 0,
            lockedUntil: null,
            lastLoginAt: null,
            ...account,
          };
  }

  async findAuthenticationByUsernameForUpdate(
    username: string,
  ): Promise<AuthenticationAccountRecord | null> {
    this.rowLockReads += 1;
    return this.account?.username === username ? { ...this.account } : null;
  }

  async findCurrentActorAccountById(
    accountId: number,
  ): Promise<CurrentActorAccountRecord | null> {
    if (!this.account || this.account.id !== accountId) return null;
    return {
      id: this.account.id,
      employeeId: this.account.employeeId,
      username: this.account.username,
      status: this.account.status,
      lockedUntil: this.account.lockedUntil,
      employeeCode: this.account.employeeId === null ? null : "EMP-045",
      employeeFirstName: this.account.employeeId === null ? null : "Mana",
      employeeLastName: this.account.employeeId === null ? null : "Example",
    };
  }

  async findActiveGrants(accountId: number): Promise<ActiveGrantRecord[]> {
    return this.account?.id === accountId ? this.grants.map((grant) => ({ ...grant })) : [];
  }

  async updateFailedLogin(
    accountId: number,
    update: FailedLoginUpdate,
  ): Promise<AuthenticationAccountRecord | null> {
    if (!this.account || this.account.id !== accountId) return null;
    this.account = { ...this.account, ...update };
    return { ...this.account };
  }

  async updateSuccessfulLogin(
    accountId: number,
    update: SuccessfulLoginUpdate,
  ): Promise<AuthenticationAccountRecord | null> {
    if (!this.account || this.account.id !== accountId) return null;
    this.account = { ...this.account, ...update };
    return { ...this.account };
  }
}

const tokenService = (): SessionTokenService => ({
  async issue(accountId) {
    return `token-${accountId}`;
  },
  async verify(token) {
    if (token !== "token-12") return null;
    return { sub: "12", iat: 1, exp: 2 } satisfies SessionClaims;
  },
});

const fixture = (
  account: Partial<AuthenticationAccountRecord> | null = {},
) => {
  const repository = new MemoryUserAccountRepository(account);
  const writer = new MemoryWriter();
  let unknownVerifications = 0;
  let knownVerifications = 0;
  const service = createUserAccountService({
    transactionRunner: new SerializedTransactionRunner(),
    repository,
    repositoryFactory: () => repository,
    tokenService: tokenService(),
    actions: new ActionObserver(rootExecutor, writer),
    domain: new DomainAuditObserver(writer),
    now: () => new Date(testTime),
    passwordVerifier: async (password) => {
      knownVerifications += 1;
      return password === "correct";
    },
    unknownAccountPasswordVerifier: async () => {
      unknownVerifications += 1;
      return false;
    },
  });
  return {
    repository,
    writer,
    service,
    knownVerifications: () => knownVerifications,
    unknownVerifications: () => unknownVerifications,
  };
};

const expectCode = async (
  operation: Promise<unknown>,
  code: ApplicationError["code"],
) => {
  try {
    await operation;
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ApplicationError);
    expect((error as ApplicationError).code).toBe(code);
    return error as ApplicationError;
  }
};

describe("user account authentication service", () => {
  test("logs in under a row-locked transaction, resets state, projects safe actor, and audits once", async () => {
    const state = fixture({ failedLoginAttempts: 4 });

    const result = await state.service.login({
      username: "mana",
      password: "correct",
      requestId: "login-success",
    });

    expect(result.token).toBe("token-12");
    expect(result.actor).toEqual({
      account: {
        id: "12",
        username: "mana",
        status: "active",
        employee: {
          id: "45",
          employeeCode: "EMP-045",
          displayName: "Mana Example",
        },
      },
      grants: [
        {
          id: "20",
          roleCode: "SUPERVISOR",
          scope: "department",
          branchId: "2",
          departmentId: "8",
        },
      ],
      capabilities: ["employee.read.department"],
    });
    expect(state.repository.rowLockReads).toBe(1);
    expect(state.repository.account).toMatchObject({
      status: "active",
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: testTime,
    });
    expect(state.writer.events).toHaveLength(1);
    expect(state.writer.events[0]).toMatchObject({
      action: "authentication.session.login.succeeded",
      actorAccountId: "12",
      recordId: "12",
      requestId: "login-success",
    });
  });

  test("commits attempts one through four with one failed audit each", async () => {
    const state = fixture();

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expectCode(
        state.service.login({
          username: "mana",
          password: "wrong",
          requestId: `login-failure-${attempt}`,
        }),
        "INVALID_CREDENTIALS",
      );
      expect(state.repository.account?.failedLoginAttempts).toBe(attempt);
      expect(state.repository.account?.status).toBe("active");
    }

    expect(state.writer.events).toHaveLength(4);
    expect(state.writer.events.every((event) => event.reason === "INVALID_CREDENTIALS")).toBe(true);
  });

  test("locks atomically on attempt five and returns the lock expiry", async () => {
    const state = fixture({ failedLoginAttempts: 4 });
    const error = await expectCode(
      state.service.login({
        username: "mana",
        password: "wrong",
        requestId: "login-fifth",
      }),
      "ACCOUNT_LOCKED",
    );

    expect(error.retryAt).toBe("2026-09-22T03:15:00.000Z");
    expect(state.repository.account).toMatchObject({
      status: "locked",
      failedLoginAttempts: 5,
      lockedUntil: new Date("2026-09-22T03:15:00.000Z"),
    });
    expect(state.writer.events).toHaveLength(1);
    expect(state.writer.events[0]).toMatchObject({
      action: "authentication.session.login.failed",
      reason: "ACCOUNT_LOCKED",
    });
  });

  test("does not verify even a correct password during an active lock", async () => {
    const state = fixture({
      status: "locked",
      failedLoginAttempts: 5,
      lockedUntil: new Date("2026-09-22T03:15:00.000Z"),
    });

    await expectCode(
      state.service.login({
        username: "mana",
        password: "correct",
        requestId: "login-locked",
      }),
      "ACCOUNT_LOCKED",
    );
    expect(state.knownVerifications()).toBe(0);
    expect(state.repository.account?.failedLoginAttempts).toBe(5);
    expect(state.writer.events).toHaveLength(1);
  });

  test("allows login exactly at expiry and clears the expired lock", async () => {
    const state = fixture({
      status: "locked",
      failedLoginAttempts: 5,
      lockedUntil: new Date(testTime),
    });

    await state.service.login({
      username: "mana",
      password: "correct",
      requestId: "login-at-expiry",
    });

    expect(state.knownVerifications()).toBe(1);
    expect(state.repository.account).toMatchObject({
      status: "active",
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
  });

  test("disabled accounts stay disabled and are audited without password verification", async () => {
    const state = fixture({ status: "disabled" });
    await expectCode(
      state.service.login({
        username: "mana",
        password: "correct",
        requestId: "login-disabled",
      }),
      "ACCOUNT_DISABLED",
    );

    expect(state.knownVerifications()).toBe(0);
    expect(state.repository.account?.status).toBe("disabled");
    expect(state.writer.events).toHaveLength(1);
    expect(state.writer.events[0]?.reason).toBe("ACCOUNT_DISABLED");
  });

  test("uses the dummy verifier for unknown users without putting credentials in audit", async () => {
    const state = fixture(null);
    await expectCode(
      state.service.login({
        username: "not-a-real-user",
        password: "do-not-record-this-password",
        requestId: "login-unknown",
      }),
      "INVALID_CREDENTIALS",
    );

    expect(state.unknownVerifications()).toBe(1);
    expect(state.knownVerifications()).toBe(0);
    expect(state.writer.events).toHaveLength(1);
    expect(state.writer.events[0]).toMatchObject({
      recordId: "unknown",
      reason: "INVALID_CREDENTIALS",
      actorAccountId: null,
    });
    const serialized = JSON.stringify(state.writer.events);
    expect(serialized).not.toContain("not-a-real-user");
    expect(serialized).not.toContain("do-not-record-this-password");
  });

  test("serializes concurrent failures so increments are not lost", async () => {
    const state = fixture();
    const attempts = Array.from({ length: 5 }, (_, index) =>
      state.service
        .login({
          username: "mana",
          password: "wrong",
          requestId: `concurrent-${index + 1}`,
        })
        .catch((error: unknown) => error),
    );

    const errors = await Promise.all(attempts);
    expect(errors.filter((error) => error instanceof ApplicationError)).toHaveLength(5);
    expect(state.repository.account).toMatchObject({
      failedLoginAttempts: 5,
      status: "locked",
    });
    expect(state.repository.rowLockReads).toBe(5);
    expect(state.writer.events).toHaveLength(5);
    expect(new Set(state.writer.events.map((event) => event.requestId)).size).toBe(5);
  });

  test("audits current-actor disclosure and idempotent logout exactly once", async () => {
    const state = fixture();
    const actor = await state.service.getCurrentActor({
      token: "token-12",
      requestId: "me-request",
    });
    await state.service.logout({
      token: undefined,
      requestId: "logout-request",
    });

    expect(actor.account.id).toBe("12");
    expect(state.writer.events.map((event) => event.action)).toEqual([
      "authentication.session.view.succeeded",
      "authentication.session.logout.succeeded",
    ]);
  });

  test("audits an unauthenticated current-actor failure once", async () => {
    const state = fixture();
    await expectCode(
      state.service.getCurrentActor({
        token: "invalid",
        requestId: "me-unauthenticated",
      }),
      "AUTH_REQUIRED",
    );
    expect(state.writer.events).toHaveLength(1);
    expect(state.writer.events[0]).toMatchObject({
      action: "authentication.session.view.failed",
      reason: "AUTH_REQUIRED",
      recordId: "self",
    });
  });
});
