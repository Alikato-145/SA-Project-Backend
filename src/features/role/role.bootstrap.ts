import type { InferInsertModel } from "drizzle-orm";
import type { roles } from "./role.schema";

export type SystemRole = Pick<
  InferInsertModel<typeof roles>,
  "code" | "name" | "scope"
>;

export const SYSTEM_ROLES = [
  { code: "EMPLOYEE", name: "Employee", scope: "self" },
  { code: "SUPERVISOR", name: "Supervisor", scope: "department" },
  { code: "BRANCH_MANAGER", name: "Branch Manager", scope: "branch" },
  { code: "HR", name: "HR", scope: "all" },
  { code: "OWNER", name: "Owner", scope: "all" },
] as const satisfies readonly SystemRole[];

export interface RoleBootstrapPort {
  ensureRole(role: (typeof SYSTEM_ROLES)[number]): Promise<void>;
}

/**
 * Ensures the immutable role catalog exists without making role CRUD public.
 * The port must insert a missing row or verify that an existing row has the
 * exact canonical name and scope. A mismatch fails setup instead of silently
 * changing authorization semantics.
 */
export const ensureSystemRoles = async (port: RoleBootstrapPort) => {
  for (const role of SYSTEM_ROLES) {
    await port.ensureRole(role);
  }
};

/**
 * Ordinary account administration requires an active Owner. Deployment setup
 * must provision one through a controlled secret-bearing command; temporary
 * credentials must never be stored in configuration or audit output.
 */
export interface InitialOwnerSetup {
  username: string;
  passwordHash: string;
  employeeId?: number;
}

