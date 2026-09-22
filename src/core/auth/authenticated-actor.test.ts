import { describe, expect, test } from "bun:test";
import {
  loadAuthenticatedActor,
  parseAccountId,
  type AuthenticatedActorRepository,
} from "./authenticated-actor";

const repository = (status: "active" | "locked" | "disabled") =>
  ({
    async findSafeById(accountId) {
      return {
        id: accountId,
        employeeId: 9007199254740991,
        username: "mana",
        status,
      };
    },
    async findActiveGrants(_accountId: number) {
      return [
        {
          id: 12,
          roleCode: "SUPERVISOR",
          scope: "department",
          branchId: 2,
          departmentId: 8,
        },
      ];
    },
  }) satisfies AuthenticatedActorRepository;

describe("authenticated actor loading", () => {
  test("projects internal numeric IDs to decimal strings with fresh grants", async () => {
    expect(await loadAuthenticatedActor("42", repository("active"))).toEqual({
      accountId: "42",
      employeeId: "9007199254740991",
      username: "mana",
      grants: [
        {
          grantId: "12",
          roleCode: "SUPERVISOR",
          scope: "department",
          branchId: "2",
          departmentId: "8",
        },
      ],
    });
  });

  test("rejects disabled and locked accounts before loading grants", async () => {
    for (const status of ["disabled", "locked"] as const) {
      let loadedGrants = false;
      const source = repository(status);
      const guardedRepository: AuthenticatedActorRepository = {
        ...source,
        async findActiveGrants(accountId) {
          loadedGrants = true;
          return source.findActiveGrants(accountId);
        },
      };

      expect(await loadAuthenticatedActor("42", guardedRepository)).toBeNull();
      expect(loadedGrants).toBe(false);
    }
  });

  test("rejects invalid or unsafe numeric account IDs", () => {
    expect(parseAccountId("0")).toBeNull();
    expect(parseAccountId("01")).toBeNull();
    expect(parseAccountId("not-an-id")).toBeNull();
    expect(parseAccountId("9007199254740992")).toBeNull();
  });
});
