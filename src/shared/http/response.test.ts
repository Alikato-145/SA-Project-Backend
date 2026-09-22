import { describe, expect, test } from "bun:test";
import { publicError, success } from "./response";

describe("HTTP response envelopes", () => {
  test("wraps public response data", () => {
    expect(success({ id: 7 })).toEqual({ ok: true, data: { id: 7 } });
  });

  test("omits error details unless explicitly supplied", () => {
    expect(publicError("FORBIDDEN", "คุณไม่มีสิทธิ์เข้าถึงส่วนนี้")).toEqual({
      ok: false,
      error: { code: "FORBIDDEN", message: "คุณไม่มีสิทธิ์เข้าถึงส่วนนี้" },
    });
  });
});
