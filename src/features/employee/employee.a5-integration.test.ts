import { describe, expect, test } from "bun:test";
import { createEmployeeOperationContextService } from "./employee.operation-context.service";
import type { AuthenticatedActor } from "../../core/auth/auth.types";

type Role = "EMPLOYEE" | "SUPERVISOR" | "BRANCH_MANAGER" | "HR" | "OWNER";
const grant = (roleCode: Role, scope: "self" | "department" | "branch" | "all", branchId: string | null = null, departmentId: string | null = null) => ({ grantId: "1", roleCode, scope, branchId, departmentId });
const actor = (employeeId: string | null, grants: AuthenticatedActor["grants"]) => ({ accountId: 99, trustedActor: { accountId: "99", employeeId, username: "a5-user", grants } });
const people = {
  employee: actor("7", [grant("EMPLOYEE", "self")]),
  supervisor: actor(null, [grant("SUPERVISOR", "department", "10", "20")]),
  manager: actor(null, [grant("BRANCH_MANAGER", "branch", "10")]),
  hr: actor(null, [grant("HR", "all")]),
  owner: actor(null, [grant("OWNER", "all")]),
};
const service = createEmployeeOperationContextService({
  async datedAssignment(employeeId: number, date: string) {
    if (employeeId === 7) {
      if (date < "2026-09-01") return undefined;
      return date < "2026-09-15"
        ? { employeeId, branchId: 10, departmentId: 20, shopId: 1, baseSalary: "20000.00" }
        : { employeeId, branchId: 11, departmentId: 21, shopId: 1, baseSalary: "25000.00" };
    }
    if (employeeId === 8) return { employeeId, branchId: 10, departmentId: 22, shopId: 1, baseSalary: "18000.00" };
    if (employeeId === 9) return { employeeId, branchId: 12, departmentId: 20, shopId: 2, baseSalary: "18000.00" };
    return undefined;
  },
  async branchShop() { return 1; },
  async shopBranches() { return [10, 11]; },
  async weeklyHoliday() { return false; },
});
type Person = typeof people[keyof typeof people];
const allow = (person: Person, employeeId: number, date: string, action: "read" | "submit" | "manage" | "finance") => service.assertEmployee(person, employeeId, date, action);
const deny = async (person: Person, employeeId: number, date: string, action: "read" | "submit" | "manage" | "finance") => {
  await expect(allow(person, employeeId, date, action)).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
};

describe("A5 dated employee context and role matrix", () => {
  test("transfer boundary resolves historical branch, department, and compensation", async () => {
    expect(await service.context(7, "2026-09-14")).toMatchObject({ branchId: 10, departmentId: 20, baseSalary: "20000.00" });
    expect(await service.context(7, "2026-09-15")).toMatchObject({ branchId: 11, departmentId: 21, baseSalary: "25000.00" });
    await expect(service.context(7, "2026-08-31")).rejects.toMatchObject({ code: "PAYROLL_ASSIGNMENT_MISSING" });
  });
  test("employee can read/submit own data but cannot manage or view others", async () => {
    expect(await allow(people.employee, 7, "2026-09-14", "read")).toBe("self");
    expect(await allow(people.employee, 7, "2026-09-15", "submit")).toBe("self");
    await deny(people.employee, 8, "2026-09-14", "read");
    await deny(people.employee, 7, "2026-09-14", "manage");
    await deny(people.employee, 7, "2026-09-14", "finance");
  });
  test("supervisor needs historical branch and department to match", async () => {
    expect(await allow(people.supervisor, 7, "2026-09-14", "manage")).toBe("department");
    await deny(people.supervisor, 7, "2026-09-15", "manage");
    await deny(people.supervisor, 8, "2026-09-14", "read");
    await deny(people.supervisor, 9, "2026-09-14", "read");
  });
  test("manager scope follows historical branch", async () => {
    expect(await allow(people.manager, 7, "2026-09-14", "manage")).toBe("branch");
    expect(await allow(people.manager, 8, "2026-09-14", "read")).toBe("branch");
    await deny(people.manager, 7, "2026-09-15", "manage");
    await deny(people.manager, 9, "2026-09-14", "read");
  });
  test("HR and owner can access all branches and global finance duty", async () => {
    for (const person of [people.hr, people.owner]) {
      expect(await allow(person, 7, "2026-09-14", "read")).toBe("all");
      expect(await allow(person, 7, "2026-09-15", "manage")).toBe("all");
      expect(await allow(person, 9, "2026-09-14", "finance")).toBe("all");
    }
  });
  test("attendance visibility uses work date across transfer", async () => {
    const rows = [{ employeeId: 7, workDate: "2026-09-14" }, { employeeId: 7, workDate: "2026-09-15" }, { employeeId: 8, workDate: "2026-09-14" }, { employeeId: 9, workDate: "2026-09-14" }];
    expect(await service.visibleWorkDays(people.supervisor, rows)).toEqual([rows[0]]);
    expect(await service.visibleWorkDays(people.manager, rows)).toEqual([rows[0], rows[2]]);
    expect(await service.visibleWorkDays(people.owner, rows)).toEqual(rows);
  });
});
