import { describe, expect, test } from "bun:test";
import { createActionContext, isValidRequestId, resolveRequestId } from "./action-context";

describe("audit action context", () => {
  test("keeps a valid bounded correlation ID", () => {
    expect(resolveRequestId("client_01:trace-2", () => "generated")).toBe("client_01:trace-2");
    expect(isValidRequestId("a".repeat(100))).toBe(true);
  });

  test("replaces missing, malformed, or oversized values", () => {
    for (const value of [undefined, "", "has space", "a".repeat(101)]) {
      expect(resolveRequestId(value, () => "generated-id")).toBe("generated-id");
    }
  });

  test("validates action and target conventions", () => {
    const context = createActionContext({
      requestId: "req-1",
      actorAccountId: "42",
      actionBase: "employee.profile.view",
      target: { tableName: "employees", recordId: "42" },
    });
    expect(context.actorAccountId).toBe("42");
    expect(() => createActionContext({ ...context, actionBase: "too.short" })).toThrow();
    expect(() => createActionContext({ ...context, target: { tableName: "employees", recordId: "0" } })).toThrow();
  });
});

