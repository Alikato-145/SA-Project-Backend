import { describe, expect, test } from "bun:test";
import { divideHalfUp, formatFixed, formatMoney, money, multiplyFixed, parseFixed, rescaleHalfUp } from "./decimal";

describe("payroll fixed-point decimals", () => {
  test("parses and formats money and four-place rates exactly", () => {
    expect(money("123.45")).toBe(12345n);
    expect(parseFixed("1.5000", 4)).toBe(15000n);
    expect(formatMoney(12345n)).toBe("123.45");
    expect(formatFixed(-125n, 2)).toBe("-1.25");
  });

  test("accepts database padding only when extra precision is exactly zero", () => {
    expect(parseFixed("30.0000", 2)).toBe(3000n);
    expect(parseFixed("-30.1200", 2)).toBe(-3012n);
    expect(parseFixed("30.0000", 0)).toBe(30n);
    expect(() => parseFixed("30.0001", 2)).toThrow("Invalid decimal value");
  });

  test("rounds half up for positive and negative ties", () => {
    expect(rescaleHalfUp(125n, 2, 1)).toBe(13n);
    expect(rescaleHalfUp(-125n, 2, 1)).toBe(-13n);
    expect(divideHalfUp(5n, 2n)).toBe(3n);
  });

  test("multiplies scaled values into rounded currency", () => {
    expect(multiplyFixed(10000n, 2, 15000n, 4, 2)).toBe(15000n);
    expect(multiplyFixed(1n, 2, 5000n, 4, 2)).toBe(1n);
  });

  test("supports negative intermediate net and rejects invalid values", () => {
    expect(formatMoney(money("10.00") - money("12.50"))).toBe("-2.50");
    expect(() => money("1.234")).toThrow();
    expect(() => parseFixed("9".repeat(31), 2)).toThrow();
    expect(() => divideHalfUp(1n, 0n)).toThrow();
  });
});
