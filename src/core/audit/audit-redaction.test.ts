import { describe, expect, test } from "bun:test";
import {
  accountAuditSnapshot,
  bankAccountAuditSnapshot,
  branchAuditSnapshot,
  departmentAuditSnapshot,
  positionAuditSnapshot,
  redactAuditSnapshot,
  shopAuditSnapshot,
} from "./audit-redaction";

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

  test("organization allowlists retain only safe resource fields", () => {
    expect(shopAuditSnapshot({
      id: "1", code: "SHOP", name: "Main", is_active: true,
      created_at: "hidden", secret: "hidden",
    })).toEqual({ id: "1", code: "SHOP", name: "Main", is_active: true });

    expect(branchAuditSnapshot({
      id: "2", shop_id: "1", code: "BKK", name: "Bangkok",
      address: "1 Main Road", timezone: "Asia/Bangkok", is_active: true,
      authorization: "hidden", updated_at: "hidden",
    })).toEqual({
      id: "2", shop_id: "1", code: "BKK", name: "Bangkok",
      address: "1 Main Road", timezone: "Asia/Bangkok", is_active: true,
    });

    expect(departmentAuditSnapshot({
      id: "3", branch_id: "2", code: "KITCHEN", name: "Kitchen",
      is_active: false, password: "hidden",
    })).toEqual({
      id: "3", branch_id: "2", code: "KITCHEN", name: "Kitchen",
      is_active: false,
    });

    expect(positionAuditSnapshot({
      id: "4", shop_id: "1", code: "CHEF", name: "Chef",
      is_active: true, note: "hidden",
    })).toEqual({
      id: "4", shop_id: "1", code: "CHEF", name: "Chef", is_active: true,
    });
  });

  test("organization snapshot helpers recursively redact forbidden nested values", () => {
    expect(branchAuditSnapshot({
      id: "2",
      address: { line: "safe", token: "hidden" },
      timezone: "Asia/Bangkok",
    })).toEqual({
      id: "2",
      address: { line: "safe" },
      timezone: "Asia/Bangkok",
    });
  });
});
