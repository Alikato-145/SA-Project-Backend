const forbiddenKey = /(?:password|temporary[_-]?password|(?:^|[_-])hash$|token|jwt|cookie|authorization|secret|national[_-]?id|passport[_-]?id|account[_-]?number(?:[_-]?ciphertext)?$)/i;

export type AuditSnapshot = Record<string, unknown>;

const redactValue = (value: unknown, seen: WeakSet<object>): unknown => {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen));
  if (typeof value !== "object") return undefined;
  if (seen.has(value)) throw new Error("Audit payload must not contain circular references");
  seen.add(value);
  const result: AuditSnapshot = {};
  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenKey.test(key)) continue;
    const safe = redactValue(nested, seen);
    if (safe !== undefined) result[key] = safe;
  }
  seen.delete(value);
  return result;
};

export const redactAuditSnapshot = (value: AuditSnapshot): AuditSnapshot =>
  redactValue(value, new WeakSet()) as AuditSnapshot;

export const allowAuditFields = <K extends string>(
  source: Record<string, unknown>,
  allowedFields: readonly K[],
): Partial<Record<K, unknown>> => {
  const selected: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(source, key)) selected[key] = source[key];
  }
  return redactAuditSnapshot(selected) as Partial<Record<K, unknown>>;
};

export const ACCOUNT_AUDIT_FIELDS = ["id", "username", "employee_id", "status", "failed_login_attempts", "locked_until"] as const;
export const ROLE_GRANT_AUDIT_FIELDS = ["id", "user_account_id", "role_id", "branch_id", "department_id", "granted_at"] as const;
export const BANK_ACCOUNT_AUDIT_FIELDS = ["id", "employee_id", "bank_code", "bank_name", "account_number_last4", "is_primary", "is_active"] as const;

export const accountAuditSnapshot = (source: Record<string, unknown>) => allowAuditFields(source, ACCOUNT_AUDIT_FIELDS);
export const roleGrantAuditSnapshot = (source: Record<string, unknown>) => allowAuditFields(source, ROLE_GRANT_AUDIT_FIELDS);
export const bankAccountAuditSnapshot = (source: Record<string, unknown>) => allowAuditFields(source, BANK_ACCOUNT_AUDIT_FIELDS);
