import { describe, expect, test } from "bun:test";
import {
  SYSTEM_ROLES,
  ensureSystemRoles,
  type RoleBootstrapPort,
} from "./role.bootstrap";

describe("system role bootstrap", () => {
  test("defines the five fixed roles with their approved scopes", () => {
    expect(SYSTEM_ROLES).toEqual([
      { code: "EMPLOYEE", name: "Employee", scope: "self" },
      { code: "SUPERVISOR", name: "Supervisor", scope: "department" },
      { code: "BRANCH_MANAGER", name: "Branch Manager", scope: "branch" },
      { code: "HR", name: "HR", scope: "all" },
      { code: "OWNER", name: "Owner", scope: "all" },
    ]);
  });

  test("is idempotent through the bootstrap port", async () => {
    const stored = new Map<string, (typeof SYSTEM_ROLES)[number]>();
    const calls: string[] = [];
    const port: RoleBootstrapPort = {
      async ensureRole(role) {
        calls.push(role.code);
        stored.set(role.code, role);
      },
    };

    await ensureSystemRoles(port);
    await ensureSystemRoles(port);

    expect([...stored.values()]).toEqual([...SYSTEM_ROLES]);
    expect(calls).toHaveLength(10);
  });

  test("fails when an existing fixed role does not match its canonical scope", async () => {
    const port: RoleBootstrapPort = {
      async ensureRole(role) {
        if (role.code === "OWNER") {
          throw new Error("ROLE_BOOTSTRAP_MISMATCH");
        }
      },
    };

    expect(ensureSystemRoles(port)).rejects.toThrow("ROLE_BOOTSTRAP_MISMATCH");
  });
});
