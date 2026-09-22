import { describe, expect, test } from "bun:test";
import { accountAuditSnapshot, bankAccountAuditSnapshot, redactAuditSnapshot } from "./audit-redaction";

describe("audit redaction", () => {
  test("recursively removes secrets from objects and arrays", () => {
    const safe = redactAuditSnapshot({
      ok: "kept",
      PasswordHash: "hash",
      nested: [{ authorization: "Bearer token", name: "kept" }, { passport_id: "P1" }],
      cookieValue: "session",
      nationalId: "123",
    });
    expect(safe).toEqual({ ok: "kept", nested: [{ name: "kept" }, {}] });
    expect(JSON.stringify(safe)).not.toContain("hash");
    expect(JSON.stringify(safe)).not.toContain("Bearer");
  });

  test("account allowlist rejects extra input including temporary credentials", () => {
    expect(accountAuditSnapshot({ id: "1", username: "safe", temporary_password: "no", note: "extra" }))
      .toEqual({ id: "1", username: "safe" });
  });

  test("bank allowlist retains last4 but not full or encrypted account values", () => {
    expect(bankAccountAuditSnapshot({
      id: "2", bank_code: "KBANK", account_number_last4: "1234",
      account_number: "111122221234", account_number_ciphertext: "cipher",
    })).toEqual({ id: "2", bank_code: "KBANK", account_number_last4: "1234" });
  });
});

