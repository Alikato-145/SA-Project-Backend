import { describe, expect, test } from "bun:test";
import { redactAuditSnapshot } from "../../core/audit/audit-redaction";
import { toPublicErrorResult } from "../../core/errors/error-boundary";
import {
  toAccountDetailResponseDto,
  toTemporaryPasswordResponseDto,
} from "../user-account/user-account.admin.mapper";

const secrets = {
  password: "fixture-password-DO-NOT-LEAK",
  temporaryPassword: "fixture-temporary-DO-NOT-LEAK",
  hash: "$argon2id$fixture-hash-DO-NOT-LEAK",
  token: "fixture.jwt.token-DO-NOT-LEAK",
  cookie: "haris_session=fixture-cookie-DO-NOT-LEAK",
  authorization: "Bearer fixture-authorization-DO-NOT-LEAK",
  nationalId: "1100000000000",
  passportId: "AA1234567",
  accountNumber: "1234567890123456",
  accountNumberCiphertext: "ciphertext-DO-NOT-LEAK",
};

const account = {
  id: "9",
  employeeId: "45",
  employeeCode: "EMP-045",
  employeeFirstName: "Mana",
  employeeLastName: "Example",
  username: "mana",
  status: "active" as const,
  failedLoginAttempts: 4,
  lockedUntil: null,
  lastLoginAt: null,
  createdAt: new Date("2026-09-22T00:00:00.000Z"),
  updatedAt: new Date("2026-09-22T00:00:00.000Z"),
};

describe("A1 end-to-end secret surfaces", () => {
  test("removes prohibited fixtures from audit snapshots, errors, logs, and ordinary account responses", () => {
    const audit = redactAuditSnapshot({
      nested: { ...secrets },
      password_hash: secrets.hash,
      bank: { account_number: secrets.accountNumber },
      safe: "retained",
    });
    const error = toPublicErrorResult(
      new Error(`${secrets.password} ${secrets.token}`),
      "request-secret-scan",
    );
    const fallbackLog = JSON.stringify({
      message: "Persistent audit unavailable",
      requestId: "request-secret-scan",
      action: "account.profile.read.failed",
    });
    const response = toAccountDetailResponseDto(
      { account, grants: [] },
      "request-secret-scan",
    );
    const combined = JSON.stringify({ audit, error, fallbackLog, response });
    for (const secret of Object.values(secrets))
      expect(combined).not.toContain(secret);
    expect(combined).toContain("retained");
  });

  test("allows a generated temporary password only in the intended one-time response field", () => {
    const response = toTemporaryPasswordResponseDto(
      { account, grants: [], temporaryPassword: secrets.temporaryPassword },
      "request-secret-scan",
    );
    expect(response.data.temporary_password).toBe(secrets.temporaryPassword);
    const withoutIntendedField = structuredClone(response) as typeof response;
    withoutIntendedField.data.temporary_password = "removed-for-scan";
    const serialized = JSON.stringify(withoutIntendedField);
    for (const [key, secret] of Object.entries(secrets)) {
      if (key !== "temporaryPassword") expect(serialized).not.toContain(secret);
    }
  });
});
