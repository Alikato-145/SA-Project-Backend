export const SESSION_COOKIE_NAME = "haris_session" as const;
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export type AccountStatus = "active" | "locked" | "disabled";
export type RoleScope = "self" | "department" | "branch" | "all";
export type RoleCode =
  | "EMPLOYEE"
  | "SUPERVISOR"
  | "BRANCH_MANAGER"
  | "HR"
  | "OWNER";

export interface AuthenticatedGrant {
  grantId: string;
  roleCode: RoleCode;
  scope: RoleScope;
  branchId: string | null;
  departmentId: string | null;
}

export interface AuthenticatedActor {
  accountId: string;
  employeeId: string | null;
  username: string;
  grants: readonly AuthenticatedGrant[];
}

/** The complete application-owned payload of a session JWT. */
export interface SessionClaims {
  sub: string;
  iat: number;
  exp: number;
}

/**
 * Structural subset of the @elysiajs/jwt decorator used by the auth service.
 * Keeping the boundary structural makes token logic independently testable.
 */
export interface SessionJwtCodec {
  sign(payload: {
    sub: string;
    iat: true;
    exp: number;
  }): Promise<string>;
  verify(token?: string): Promise<unknown | false>;
}

export interface SessionCookieOptions {
  value: string;
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  secure: boolean;
  maxAge: number;
}
