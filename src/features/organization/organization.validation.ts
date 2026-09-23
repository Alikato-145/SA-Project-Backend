import { ApplicationError } from "../../core/errors/application.error";

const positiveDecimalPattern = /^[1-9][0-9]*$/;

const invalid = (field: string): never => {
  throw new ApplicationError("VALIDATION_ERROR", {
    fieldErrors: { [field]: ["Invalid value."] },
  });
};

const characterLength = (value: string): number => Array.from(value).length;

/** Trim and validate a required public text value. */
export const parseRequiredTrimmedText = (
  value: unknown,
  field: string,
  maximumLength: number,
): string => {
  if (typeof value !== "string") return invalid(field);
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    characterLength(trimmed) > maximumLength
  ) {
    return invalid(field);
  }
  return trimmed;
};

/**
 * Trim an optional nullable text value. Empty text is normalized to null so
 * persistence never has to distinguish blank addresses from absent ones.
 */
export const parseOptionalTrimmedText = (
  value: unknown,
  field: string,
  maximumLength: number,
): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return invalid(field);
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (characterLength(trimmed) > maximumLength) return invalid(field);
  return trimmed;
};

/**
 * Parse a decimal PostgreSQL bigint identifier into the repository's current
 * safe-number representation. No signs, leading zeroes, fractions, exponents,
 * whitespace, or numeric coercion are accepted at the public boundary.
 */
export const parseDecimalBigIntId = (
  value: unknown,
  field: string,
): number => {
  if (typeof value !== "string" || !positiveDecimalPattern.test(value)) {
    return invalid(field);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return invalid(field);
  return parsed;
};

const parsePositiveInteger = (
  value: unknown,
  fallback: number,
  field: string,
  maximum: number,
): number => {
  if (value === undefined) return fallback;

  if (typeof value === "number") {
    if (
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > maximum
    ) {
      return invalid(field);
    }
    return value;
  }

  if (typeof value !== "string" || !positiveDecimalPattern.test(value)) {
    return invalid(field);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) return invalid(field);
  return parsed;
};

export interface PaginationInput {
  page?: unknown;
  page_size?: unknown;
}

export interface ParsedPagination {
  page: number;
  pageSize: number;
}

/** Parse common organization list pagination with contract defaults. */
export const parsePagination = (input: PaginationInput): ParsedPagination => ({
  page: parsePositiveInteger(
    input.page,
    1,
    "page",
    Number.MAX_SAFE_INTEGER,
  ),
  pageSize: parsePositiveInteger(input.page_size, 20, "page_size", 100),
});

/** Parse the exact true/false list filter; omission means active-only. */
export const parseBooleanFilter = (
  value: unknown,
  field: string,
  fallback = true,
): boolean => {
  if (value === undefined) return fallback;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return invalid(field);
};

/** Trim and validate an IANA timezone, defaulting creates to Asia/Bangkok. */
export const parseIanaTimezone = (
  value: unknown,
  field: string,
  fallback = "Asia/Bangkok",
): string => {
  if (value === undefined) return fallback;
  if (typeof value !== "string") return invalid(field);
  const timezone = value.trim();
  if (timezone.length === 0 || characterLength(timezone) > 50) {
    return invalid(field);
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
  } catch {
    return invalid(field);
  }

  return timezone;
};
