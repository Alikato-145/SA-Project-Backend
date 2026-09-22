import { describe, expect, test } from "bun:test";
import {
  isAccountTemporarilyLocked,
  nextFailedLoginState,
  successfulLoginState,
} from "./user-account.lockout";

const now = new Date("2026-09-22T03:00:00.000Z");

describe("account lockout state", () => {
  test.each([
    [0, 1],
    [3, 4],
  ])("increments failure %i to %i without locking", (current, expected) => {
    expect(nextFailedLoginState(current, now, 5, 900)).toEqual({
      failedLoginAttempts: expected,
      status: "active",
      lockedUntil: null,
    });
  });

  test("locks for 15 minutes on the fifth failure", () => {
    expect(nextFailedLoginState(4, now, 5, 900)).toEqual({
      failedLoginAttempts: 5,
      status: "locked",
      lockedUntil: new Date("2026-09-22T03:15:00.000Z"),
    });
  });

  test("remains locked before expiry and is unlocked exactly at expiry", () => {
    const lockedUntil = new Date("2026-09-22T03:15:00.000Z");
    expect(
      isAccountTemporarilyLocked(
        { status: "locked", lockedUntil },
        new Date("2026-09-22T03:14:59.999Z"),
      ),
    ).toBe(true);
    expect(
      isAccountTemporarilyLocked(
        { status: "locked", lockedUntil },
        new Date("2026-09-22T03:15:00.000Z"),
      ),
    ).toBe(false);
  });

  test("treats locked without an expiry as locked instead of silently enabling it", () => {
    expect(
      isAccountTemporarilyLocked(
        { status: "locked", lockedUntil: null },
        now,
      ),
    ).toBe(true);
  });

  test("successful login clears lockout state and records the login time", () => {
    expect(successfulLoginState(now)).toEqual({
      failedLoginAttempts: 0,
      status: "active",
      lockedUntil: null,
      lastLoginAt: now,
    });
  });
});

