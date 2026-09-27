import { describe, expect, test } from "bun:test";
import {
  hashPassword,
  isArgon2idHash,
  verifyPassword,
  verifyPasswordForUnknownAccount,
} from "./password";

describe("password primitives", () => {
  test("hashes and verifies passwords with Argon2id", async () => {
    const hash = await hashPassword("correct horse battery staple");

    expect(isArgon2idHash(hash)).toBe(true);
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  test("runs the dummy verification path without accepting a password", async () => {
    expect(await verifyPasswordForUnknownAccount("any submitted password")).toBe(
      false,
    );
  });
});
