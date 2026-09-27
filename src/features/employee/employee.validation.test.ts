import { describe, expect, test } from "bun:test";
import { ApplicationError } from "../../core/errors/application.error";
import {
  parseEmployeeId,
  parseBusinessDate,
  parseMoney,
} from "./employee.validation";

const invalid = (operation: () => unknown, field: string) => {
  try {
    operation();
    throw new Error("Expected validation failure");
  } catch (error) {
    expect(error).toBeInstanceOf(ApplicationError);
    expect(error).toMatchObject({ code: "VALIDATION_ERROR", fieldErrors: { [field]: ["Invalid value."] } });
  }
};

describe("employee boundary validation", () => {
  test("accepts only canonical safe decimal IDs", () => {
    expect(parseEmployeeId("1", "employee_id")).toBe(1);
    for (const value of ["0", "01", "-1", "1.0", "1e3", "9007199254740992", 1, null]) invalid(() => parseEmployeeId(value, "employee_id"), "employee_id");
  });

  test("accepts real ISO business dates only", () => {
    expect(parseBusinessDate("2024-02-29", "effective_from")).toBe("2024-02-29");
    for (const value of ["2024-02-30", "2023-02-29", "2024-2-9", "2024-01-01T00:00:00Z", "", null]) invalid(() => parseBusinessDate(value, "effective_from"), "effective_from");
  });

  test("canonicalizes exact numeric(12,2) money without floating point", () => {
    expect(parseMoney("0", "base_salary")).toBe("0.00");
    expect(parseMoney("1234567890.12", "base_salary")).toBe("1234567890.12");
    for (const value of ["-1", "+1", "01.00", "1.234", "10000000000.00", "1e2", 1.2, null]) invalid(() => parseMoney(value, "base_salary"), "base_salary");
  });
});
