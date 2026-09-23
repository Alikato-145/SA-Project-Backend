import { describe, expect, test } from "bun:test";
import { ApplicationError } from "../../core/errors/application.error";
import {
  parseBooleanFilter,
  parseDecimalBigIntId,
  parseIanaTimezone,
  parseOptionalTrimmedText,
  parsePagination,
  parseRequiredTrimmedText,
} from "./organization.validation";

const expectInvalidField = (operation: () => unknown, field: string) => {
  try {
    operation();
    throw new Error("Expected validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(ApplicationError);
    expect(error).toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: { [field]: ["Invalid value."] },
    });
  }
};

describe("organization validation", () => {
  test("trims required and optional text at the boundary", () => {
    expect(parseRequiredTrimmedText("  BKK-01  ", "code", 30)).toBe(
      "BKK-01",
    );
    expect(parseOptionalTrimmedText(undefined, "address", 500)).toBeUndefined();
    expect(parseOptionalTrimmedText(null, "address", 500)).toBeNull();
    expect(parseOptionalTrimmedText("   ", "address", 500)).toBeNull();
    expect(parseOptionalTrimmedText("  Silom  ", "address", 500)).toBe(
      "Silom",
    );
  });

  test("rejects empty, overlong, and non-string text", () => {
    expectInvalidField(
      () => parseRequiredTrimmedText("   ", "code", 30),
      "code",
    );
    expectInvalidField(
      () => parseRequiredTrimmedText("x".repeat(31), "code", 30),
      "code",
    );
    expectInvalidField(
      () => parseRequiredTrimmedText(123, "code", 30),
      "code",
    );
    expectInvalidField(
      () => parseOptionalTrimmedText("x".repeat(501), "address", 500),
      "address",
    );
  });

  test("accepts canonical safe positive decimal bigint identifiers", () => {
    expect(parseDecimalBigIntId("1", "shop_id")).toBe(1);
    expect(parseDecimalBigIntId(String(Number.MAX_SAFE_INTEGER), "shop_id")).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  test("rejects unsafe or non-canonical identifiers without coercion", () => {
    for (const value of [
      "",
      "0",
      "01",
      "-1",
      "+1",
      "1.0",
      "1e3",
      " 1 ",
      "9007199254740992",
      1,
      null,
      undefined,
    ]) {
      expectInvalidField(
        () => parseDecimalBigIntId(value, "shop_id"),
        "shop_id",
      );
    }
  });

  test("applies pagination defaults and accepts bounded integers", () => {
    expect(parsePagination({})).toEqual({ page: 1, pageSize: 20 });
    expect(parsePagination({ page: "3", page_size: "100" })).toEqual({
      page: 3,
      pageSize: 100,
    });
  });

  test("rejects invalid pagination values", () => {
    for (const value of [
      "0",
      "01",
      "1.5",
      "1e2",
      "9007199254740992",
      "safe",
    ]) {
      expectInvalidField(() => parsePagination({ page: value }), "page");
    }
    for (const value of ["0", "101", "1.5", "01"]) {
      expectInvalidField(
        () => parsePagination({ page_size: value }),
        "page_size",
      );
    }
  });

  test("parses only explicit boolean filter values", () => {
    expect(parseBooleanFilter(undefined, "is_active")).toBe(true);
    expect(parseBooleanFilter("true", "is_active")).toBe(true);
    expect(parseBooleanFilter("false", "is_active")).toBe(false);
    expect(parseBooleanFilter(true, "is_active")).toBe(true);
    expect(parseBooleanFilter(false, "is_active")).toBe(false);

    for (const value of ["TRUE", "False", "1", "", 1, null]) {
      expectInvalidField(
        () => parseBooleanFilter(value, "is_active"),
        "is_active",
      );
    }
  });

  test("trims, defaults, and validates IANA timezones", () => {
    expect(parseIanaTimezone(undefined, "timezone")).toBe("Asia/Bangkok");
    expect(parseIanaTimezone("  Asia/Tokyo  ", "timezone")).toBe(
      "Asia/Tokyo",
    );
    expect(parseIanaTimezone("America/New_York", "timezone")).toBe(
      "America/New_York",
    );

    for (const value of [
      "",
      "Bangkok",
      "Asia/Not_A_Zone",
      "x".repeat(51),
      123,
      null,
    ]) {
      expectInvalidField(
        () => parseIanaTimezone(value, "timezone"),
        "timezone",
      );
    }
  });
});
