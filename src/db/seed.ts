import { and, eq, isNull } from "drizzle-orm";
import { closeDatabase, db } from "../core/db/client";
import { hashPassword, verifyPassword } from "../core/auth/password";
import { SYSTEM_ROLES } from "../features/role/role.bootstrap";
import { roles } from "../features/role/role.schema";
import {
  userAccountRoles,
  userAccounts,
} from "../features/user-account/user-account.schema";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "password";

const seed = async () => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Development credentials must not be seeded in production.");
  }

  await db.transaction(async (transaction) => {
    for (const systemRole of SYSTEM_ROLES) {
      const [existingRole] = await transaction
        .select()
        .from(roles)
        .where(eq(roles.code, systemRole.code))
        .limit(1);

      if (!existingRole) {
        await transaction.insert(roles).values(systemRole);
        continue;
      }

      if (
        existingRole.name !== systemRole.name ||
        existingRole.scope !== systemRole.scope ||
        !existingRole.isActive
      ) {
        throw new Error(`System role ${systemRole.code} does not match the canonical role catalog.`);
      }
    }

    const [ownerRole] = await transaction
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.code, "OWNER"))
      .limit(1);

    if (!ownerRole) throw new Error("OWNER role bootstrap failed.");

    const [existingAccount] = await transaction
      .select()
      .from(userAccounts)
      .where(eq(userAccounts.username, ADMIN_USERNAME))
      .limit(1);

    let accountId: number;
    if (existingAccount) {
      if (existingAccount.status !== "active") {
        throw new Error("The seeded admin account exists but is not active.");
      }
      if (!(await verifyPassword(ADMIN_PASSWORD, existingAccount.passwordHash))) {
        throw new Error("The admin account already exists with a different password; seed refused to overwrite it.");
      }
      accountId = existingAccount.id;
    } else {
      const [createdAccount] = await transaction
        .insert(userAccounts)
        .values({
          username: ADMIN_USERNAME,
          passwordHash: await hashPassword(ADMIN_PASSWORD),
          status: "active",
        })
        .returning({ id: userAccounts.id });

      if (!createdAccount) throw new Error("Admin account seed failed.");
      accountId = createdAccount.id;
    }

    const [existingGrant] = await transaction
      .select({ id: userAccountRoles.id })
      .from(userAccountRoles)
      .where(
        and(
          eq(userAccountRoles.userAccountId, accountId),
          eq(userAccountRoles.roleId, ownerRole.id),
          isNull(userAccountRoles.branchId),
          isNull(userAccountRoles.departmentId),
        ),
      )
      .limit(1);

    if (!existingGrant) {
      await transaction.insert(userAccountRoles).values({
        userAccountId: accountId,
        roleId: ownerRole.id,
        branchId: null,
        departmentId: null,
        grantedByUserAccountId: null,
      });
    }
  });

  console.log(`Seeded development Owner account: ${ADMIN_USERNAME}`);
};

try {
  await seed();
} finally {
  await closeDatabase();
}
