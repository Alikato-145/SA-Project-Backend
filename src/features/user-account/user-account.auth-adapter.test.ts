import { describe, expect, test } from "bun:test";
import { createAuthenticatedActorLoader } from "./user-account.auth-adapter";

describe("user-account authentication adapter", () => {
  test("reloads account state and only repository-approved active grants", async () => {
    const repository = {
      async findSafeById(accountId: number) {
        expect(accountId).toBe(12);
        return {
          id: 12,
          employeeId: 45,
          username: "mana",
          status: "active" as const,
          lockedUntil: null,
        };
      },
      async findActiveGrants(accountId: number) {
        expect(accountId).toBe(12);
        return [
          {
            id: 20,
            roleCode: "SUPERVISOR" as const,
            scope: "department" as const,
            branchId: 2,
            departmentId: 8,
          },
        ];
      },
    };

    await expect(
      createAuthenticatedActorLoader(repository).loadForAuthentication("12"),
    ).resolves.toEqual({
      accountId: "12",
      employeeId: "45",
      username: "mana",
      status: "active",
      lockedUntil: null,
      grants: [
        {
          grantId: "20",
          roleCode: "SUPERVISOR",
          scope: "department",
          branchId: "2",
          departmentId: "8",
          roleActive: true,
        },
      ],
    });
  });

  test("rejects malformed account IDs before querying", async () => {
    const repository = {
      async findSafeById() {
        throw new Error("must not query");
      },
      async findActiveGrants() {
        throw new Error("must not query");
      },
    };

    await expect(
      createAuthenticatedActorLoader(repository).loadForAuthentication("01"),
    ).resolves.toBeNull();
  });
});
