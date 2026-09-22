import { describe, expect, test } from "bun:test";
import { ApplicationError } from "./application.error";
import { toPublicErrorResult } from "./error-boundary";

describe("public error boundary", () => {
  test("maps typed errors to a stable envelope with request correlation", () => {
    const result = toPublicErrorResult(
      new ApplicationError("VALIDATION_ERROR", {
        fieldErrors: { username: ["Username is required."] },
      }),
      "request-123",
    );

    expect(result).toEqual({
      status: 422,
      body: {
        error: {
          code: "VALIDATION_ERROR",
          message: "The submitted data is invalid.",
          field_errors: { username: ["Username is required."] },
        },
        request_id: "request-123",
      },
    });
  });

  test("includes a safe retry time for a locked account", () => {
    expect(
      toPublicErrorResult(
        new ApplicationError("ACCOUNT_LOCKED", {
          retryAt: "2026-09-22T08:15:00.000Z",
        }),
        "request-locked",
      ),
    ).toEqual({
      status: 423,
      body: {
        error: {
          code: "ACCOUNT_LOCKED",
          message: "This account is temporarily locked.",
          retry_at: "2026-09-22T08:15:00.000Z",
        },
        request_id: "request-locked",
      },
    });
  });

  test("redacts unknown errors, SQL text, stack data, and causes", () => {
    const secret = "submitted-password-and-sql-detail";
    const result = toPublicErrorResult(
      new Error(`password=${secret}; SELECT * FROM user_accounts`),
      "request-internal",
    );
    const serialized = JSON.stringify(result);

    expect(result).toEqual({
      status: 500,
      body: {
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred.",
        },
        request_id: "request-internal",
      },
    });
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("SELECT");
    expect(serialized).not.toContain("stack");
  });

  test("does not serialize an internal cause from a typed error", () => {
    const result = toPublicErrorResult(
      new ApplicationError("STATE_CONFLICT", {
        cause: new Error("password_hash=secret-hash"),
      }),
      "request-conflict",
    );

    expect(JSON.stringify(result)).not.toContain("secret-hash");
    expect(result.body.error.code).toBe("STATE_CONFLICT");
  });
});
