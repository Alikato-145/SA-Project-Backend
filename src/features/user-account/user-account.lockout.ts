import type { AccountStatus } from "../../core/auth/auth.types";

export interface LockableAccountState {
  status: AccountStatus;
  lockedUntil: Date | null;
}

export interface FailedLoginState extends LockableAccountState {
  failedLoginAttempts: number;
}

export interface SuccessfulLoginState extends FailedLoginState {
  lastLoginAt: Date;
}

export const isAccountTemporarilyLocked = (
  account: LockableAccountState,
  now: Date,
): boolean =>
  account.status === "locked" &&
  (account.lockedUntil === null || account.lockedUntil.getTime() > now.getTime());

export const nextFailedLoginState = (
  currentAttempts: number,
  now: Date,
  maxFailedAttempts: number,
  lockDurationSeconds: number,
): FailedLoginState => {
  if (!Number.isInteger(currentAttempts) || currentAttempts < 0) {
    throw new RangeError("Current failed login attempts must be non-negative.");
  }
  if (!Number.isInteger(maxFailedAttempts) || maxFailedAttempts <= 0) {
    throw new RangeError("Maximum failed attempts must be positive.");
  }
  if (!Number.isInteger(lockDurationSeconds) || lockDurationSeconds <= 0) {
    throw new RangeError("Lock duration must be positive.");
  }

  const failedLoginAttempts = currentAttempts + 1;
  const shouldLock = failedLoginAttempts >= maxFailedAttempts;

  return {
    failedLoginAttempts,
    status: shouldLock ? "locked" : "active",
    lockedUntil: shouldLock
      ? new Date(now.getTime() + lockDurationSeconds * 1_000)
      : null,
  };
};

export const successfulLoginState = (now: Date): SuccessfulLoginState => ({
  failedLoginAttempts: 0,
  status: "active",
  lockedUntil: null,
  lastLoginAt: now,
});

