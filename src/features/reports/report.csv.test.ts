import { test, expect } from "bun:test";
import { csv } from "./report.csv";
test("CSV preserves exact decimal and leading-zero identifiers while escaping formulas and quotes", () => {
  expect(csv([["0000123", "25000.40", '=HYPERLINK("example")', "a,b\nc"]])).toBe('"0000123","25000.40","\'=HYPERLINK(""example"")","a,b\nc"\r\n');
});
