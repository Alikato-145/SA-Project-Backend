import { describe, expect, test } from "bun:test";
import {
  isExactAllowedOrigin,
  validateCookieMutationRequest,
} from "./csrf-origin";

const allowedOrigins = ["https://payroll.example.com", "http://localhost:3000"];

const mutationRequest = (
  path: string,
  method: string,
  origin: string | undefined,
  contentType: string | undefined = "application/json",
) => {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  if (contentType) headers.set("content-type", contentType);

  return new Request(`https://api.example.com${path}`, { method, headers });
};

describe("cookie mutation request validation", () => {
  test("uses exact origin matching", () => {
    expect(isExactAllowedOrigin("https://payroll.example.com", allowedOrigins)).toBe(
      true,
    );
    expect(
      isExactAllowedOrigin("https://payroll.example.com.evil.test", allowedOrigins),
    ).toBe(false);
    expect(isExactAllowedOrigin("null", allowedOrigins)).toBe(false);
    expect(isExactAllowedOrigin(null, allowedOrigins)).toBe(false);
  });

  test.each([
    ["/api/v1/auth/login", "POST"],
    ["/api/v1/auth/logout", "POST"],
    ["/api/v1/accounts/1/status", "PATCH"],
    ["/api/v1/accounts/1/roles/2", "DELETE"],
  ])("requires an allowed Origin for %s", (path, method) => {
    expect(
      validateCookieMutationRequest(
        mutationRequest(path, method, undefined),
        allowedOrigins,
      ),
    ).toEqual({ allowed: false, rejection: "ORIGIN_NOT_ALLOWED" });
  });

  test("requires application/json, including login and logout", () => {
    for (const path of ["/api/v1/auth/login", "/api/v1/auth/logout"]) {
      expect(
        validateCookieMutationRequest(
          mutationRequest(path, "POST", allowedOrigins[0], "text/plain"),
          allowedOrigins,
        ),
      ).toEqual({
        allowed: false,
        rejection: "JSON_CONTENT_TYPE_REQUIRED",
      });
    }
  });

  test("accepts an allowed JSON mutation and does not constrain safe methods", () => {
    expect(
      validateCookieMutationRequest(
        mutationRequest(
          "/api/v1/auth/login",
          "POST",
          allowedOrigins[0],
          "application/json; charset=utf-8",
        ),
        allowedOrigins,
      ),
    ).toEqual({ allowed: true });

    expect(
      validateCookieMutationRequest(
        mutationRequest("/api/v1/auth/me", "GET", undefined, undefined),
        allowedOrigins,
      ),
    ).toEqual({ allowed: true });
  });
});
