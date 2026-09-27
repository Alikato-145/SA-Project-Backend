import { ApplicationError } from "../../core/errors/application.error";

const invalid = (field: string): never => {
  throw new ApplicationError("VALIDATION_ERROR", {
    fieldErrors: { [field]: ["Invalid value."] },
  });
};

/** Current Drizzle bigint mode is number; reject IDs that cannot round-trip safely. */
export const parseEmployeeId = (value: unknown, field: string): number => {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return invalid(field);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return invalid(field);
  return parsed;
};

/** Date-only, actual Gregorian calendar date; no timezone conversion. */
export const parseBusinessDate = (value: unknown, field: string): string => {
  if (typeof value !== "string") return invalid(field);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return invalid(field);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return invalid(field);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > days[month - 1]!) return invalid(field);
  return value;
};

/** Preserve numeric(12,2) as an exact decimal string, never a JS number. */
export const parseMoney = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,9})(?:\.\d{2})?$/.test(value)) {
    return invalid(field);
  }
  return value.includes(".") ? value : `${value}.00`;
};
