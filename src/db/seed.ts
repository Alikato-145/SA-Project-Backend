import { and, eq, isNull } from "drizzle-orm";
import { closeDatabase, db } from "../core/db/client";
import { hashPassword, verifyPassword } from "../core/auth/password";
import { SYSTEM_ROLES } from "../features/role/role.bootstrap";
import { roles } from "../features/role/role.schema";
import { shops } from "../features/shop/shop.schema";
import { branches } from "../features/branch/branch.schema";
import { branchSchedules } from "../features/branch-schedule/branch-schedule.schema";
import { workDayRecords } from "../features/attendance/attendance.schema";
import { departments } from "../features/department/department.schema";
import { debtTypes } from "../features/debt/debt.schema";
import { employees } from "../features/employee/employee.schema";
import { employmentAssignments } from "../features/employment-assignment/employment-assignment.schema";
import { employeeWeeklyHolidays } from "../features/employee-weekly-holiday/employee-weekly-holiday.schema";
import { leaveQuotas, leaveTypes } from "../features/leave/leave.schema";
import { payrollConfigurations, payrollPeriods } from "../features/payroll/payroll.schema";
import { positions } from "../features/position/position.schema";
import {
  userAccountRoles,
  userAccounts,
} from "../features/user-account/user-account.schema";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "password";
const DEMO_SHOP_CODE = "DEMO";
const DEMO_BRANCH_CODE = "DEMO-BKK";
const DEMO_DEPARTMENT_CODE = "DEMO-HR";
const DEMO_EMPLOYEE_CODE = "DEMO-EMPLOYEE";

const seed = async () => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Development credentials must not be seeded in production.");
  }

  await db.transaction(async (transaction) => {
    const [demoShop] = await transaction
      .select({ id: shops.id })
      .from(shops)
      .where(eq(shops.code, DEMO_SHOP_CODE))
      .limit(1);
    let demoShopId = demoShop?.id;
    if (!demoShopId) {
      const [createdShop] = await transaction.insert(shops).values({
        code: DEMO_SHOP_CODE,
        name: "ร้านตัวอย่าง Haris",
      }).returning({ id: shops.id });
      if (!createdShop) throw new Error("Demo shop seed failed.");
      demoShopId = createdShop.id;
    }

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

    const [demoBranch] = await transaction
      .select({ id: branches.id })
      .from(branches)
      .where(
        and(
          eq(branches.shopId, demoShopId),
          eq(branches.code, DEMO_BRANCH_CODE),
        ),
      )
      .limit(1);
    let demoBranchId = demoBranch?.id;
    if (!demoBranchId) {
      const [createdBranch] = await transaction
        .insert(branches)
        .values({
          shopId: demoShopId,
          code: DEMO_BRANCH_CODE,
          name: "สาขาตัวอย่าง กรุงเทพฯ",
        })
        .returning({ id: branches.id });
      if (!createdBranch) throw new Error("Demo branch seed failed.");
      demoBranchId = createdBranch.id;
    }

    const [demoDepartment] = await transaction
      .select({ id: departments.id })
      .from(departments)
      .where(
        and(
          eq(departments.branchId, demoBranchId),
          eq(departments.code, DEMO_DEPARTMENT_CODE),
        ),
      )
      .limit(1);
    let demoDepartmentId = demoDepartment?.id;
    if (!demoDepartmentId) {
      const [createdDepartment] = await transaction
        .insert(departments)
        .values({
          branchId: demoBranchId,
          code: DEMO_DEPARTMENT_CODE,
          name: "ฝ่ายบุคคลตัวอย่าง",
        })
        .returning({ id: departments.id });
      if (!createdDepartment) throw new Error("Demo department seed failed.");
      demoDepartmentId = createdDepartment.id;
    }

    const [demoEmployee] = await transaction
      .select({ id: employees.id })
      .from(employees)
      .where(eq(employees.employeeCode, DEMO_EMPLOYEE_CODE))
      .limit(1);
    let demoEmployeeId = demoEmployee?.id;
    if (!demoEmployeeId) {
      const [createdEmployee] = await transaction
        .insert(employees)
        .values({
          employeeCode: DEMO_EMPLOYEE_CODE,
          passportId: "DEMO-EMPLOYEE-PASSPORT",
          firstName: "Demo",
          lastName: "Employee",
          hireDate: "2026-01-01",
          status: "active",
        })
        .returning({ id: employees.id });
      if (!createdEmployee) throw new Error("Demo employee seed failed.");
      demoEmployeeId = createdEmployee.id;
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

    const ensureDevelopmentAccount = async ({
      username,
      roleCode,
      employeeId,
      branchId,
      departmentId,
    }: {
      username: string;
      roleCode: string;
      employeeId: number | null;
      branchId: number | null;
      departmentId: number | null;
    }) => {
      const [role] = await transaction
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.code, roleCode))
        .limit(1);
      if (!role) throw new Error(`${roleCode} role bootstrap failed.`);

      const [account] = await transaction
        .select()
        .from(userAccounts)
        .where(eq(userAccounts.username, username))
        .limit(1);

      let userAccountId: number;
      if (account) {
        if (account.status !== "active" || account.employeeId !== employeeId) {
          throw new Error(
            `The seeded ${username} account has unexpected account details.`,
          );
        }
        if (!(await verifyPassword(ADMIN_PASSWORD, account.passwordHash))) {
          throw new Error(
            `The seeded ${username} account already has a different password; seed refused to overwrite it.`,
          );
        }
        userAccountId = account.id;
      } else {
        const [createdAccount] = await transaction
          .insert(userAccounts)
          .values({
            username,
            employeeId,
            passwordHash: await hashPassword(ADMIN_PASSWORD),
            status: "active",
          })
          .returning({ id: userAccounts.id });
        if (!createdAccount) throw new Error(`${username} account seed failed.`);
        userAccountId = createdAccount.id;
      }

      const scope = [
        eq(userAccountRoles.userAccountId, userAccountId),
        eq(userAccountRoles.roleId, role.id),
        branchId === null
          ? isNull(userAccountRoles.branchId)
          : eq(userAccountRoles.branchId, branchId),
        departmentId === null
          ? isNull(userAccountRoles.departmentId)
          : eq(userAccountRoles.departmentId, departmentId),
      ];
      const [grant] = await transaction
        .select({ id: userAccountRoles.id })
        .from(userAccountRoles)
        .where(and(...scope))
        .limit(1);

      if (!grant) {
        await transaction.insert(userAccountRoles).values({
          userAccountId,
          roleId: role.id,
          branchId,
          departmentId,
          grantedByUserAccountId: accountId,
        });
      }
    };

    await ensureDevelopmentAccount({
      username: "hr",
      roleCode: "HR",
      employeeId: null,
      branchId: null,
      departmentId: null,
    });
    await ensureDevelopmentAccount({
      username: "branch_manager",
      roleCode: "BRANCH_MANAGER",
      employeeId: null,
      branchId: demoBranchId,
      departmentId: null,
    });
    await ensureDevelopmentAccount({
      username: "supervisor",
      roleCode: "SUPERVISOR",
      employeeId: null,
      branchId: null,
      departmentId: demoDepartmentId,
    });
    await ensureDevelopmentAccount({
      username: "employee",
      roleCode: "EMPLOYEE",
      employeeId: demoEmployeeId,
      branchId: null,
      departmentId: null,
    });

    // C4's role smoke needs an effective operational context, not only accounts.
    const now = new Date();
    const bangkok = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(now);
    const [year, month, day] = bangkok.split("-").map(Number) as [number, number, number];
    const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
    const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    const effectiveFrom = `${year}-01-01`;

    await transaction.insert(positions).values({ shopId: demoShopId, code: "DEMO-STAFF", name: "พนักงานตัวอย่าง" })
      .onConflictDoNothing();
    const [position] = await transaction.select({ id: positions.id }).from(positions)
      .where(and(eq(positions.shopId, demoShopId), eq(positions.code, "DEMO-STAFF"))).limit(1);
    if (!position) throw new Error("Demo position seed failed.");

    await transaction.insert(employmentAssignments).values({
      employeeId: demoEmployeeId, branchId: demoBranchId, departmentId: demoDepartmentId,
      positionId: position.id, baseSalary: "20000.00", welfareAmount: "1000.00",
      effectiveFrom, createdByUserAccountId: accountId,
    }).onConflictDoNothing();

    await transaction.insert(branchSchedules).values({
      branchId: demoBranchId, workStartTime: "09:00:00", standardCloseTime: "18:00:00",
      lateGraceMinutes: 10, effectiveFrom,
    }).onConflictDoNothing();
    await transaction.insert(employeeWeeklyHolidays).values({
      employeeId: demoEmployeeId, weekday: 0, effectiveFrom,
    }).onConflictDoNothing();

    const payrollConfig = [
      ["STANDARD_WORK_DAYS", "26.0000", "days"], ["ABSENCE_RATE", "1.0000", "multiplier"],
      ["LATE_RATE", "2.0000", "currency_per_minute"], ["SOCIAL_SECURITY_RATE", "0.0500", "ratio"],
      ["SOCIAL_SECURITY_CAP", "750.0000", "currency"], ["OT_HOURLY_RATE", "1.5000", "multiplier"],
      ["OT_REST_DAY_RATE", "1.0000", "multiplier"], ["OT_PUBLIC_HOLIDAY_RATE", "2.0000", "multiplier"],
    ] as const;
    for (const [configKey, numericValue, unit] of payrollConfig) {
      await transaction.insert(payrollConfigurations).values({
        shopId: demoShopId, branchId: demoBranchId, configKey, numericValue, unit,
        effectiveFrom, createdByUserAccountId: accountId,
      }).onConflictDoNothing();
    }

    const leaveTypeSeeds = [
      { code: "DEMO_SICK", nameTh: "ลาป่วย", quotaType: "fixed", quotaDays: "30.00", isDeductible: false, requiresDocument: false },
      { code: "DEMO_PERSONAL", nameTh: "ลากิจ", quotaType: "fixed", quotaDays: "3.00", isDeductible: false, requiresDocument: false },
      { code: "DEMO_ANNUAL", nameTh: "ลาพักร้อน", quotaType: "fixed", quotaDays: "6.00", isDeductible: false, requiresDocument: false },
      { code: "DEMO_UNPAID", nameTh: "ลาไม่รับค่าจ้าง", quotaType: "none", quotaDays: null, isDeductible: true, requiresDocument: false },
    ] as const;
    for (const leaveType of leaveTypeSeeds) {
      await transaction.insert(leaveTypes).values(leaveType).onConflictDoUpdate({
        target: leaveTypes.code,
        set: { nameTh: leaveType.nameTh, quotaType: leaveType.quotaType, quotaDays: leaveType.quotaDays, isDeductible: leaveType.isDeductible, requiresDocument: leaveType.requiresDocument, isActive: true },
      });
      if (leaveType.quotaDays) {
        const [type] = await transaction.select({ id: leaveTypes.id }).from(leaveTypes).where(eq(leaveTypes.code, leaveType.code)).limit(1);
        if (!type) throw new Error(`Leave type seed failed: ${leaveType.code}`);
        await transaction.insert(leaveQuotas).values({ employeeId: demoEmployeeId, leaveTypeId: type.id, quotaYear: year, entitledDays: leaveType.quotaDays, usedDays: "0" }).onConflictDoNothing();
      }
    }
    await transaction.insert(debtTypes).values({
      code: "DEMO_FOOD", nameTh: "ค่าอาหารตัวอย่าง", description: "ข้อมูลสำหรับทดสอบ C4",
    }).onConflictDoNothing();
    await transaction.insert(payrollPeriods).values({
      shopId: demoShopId, periodYear: year, periodMonth: month, startDate: monthStart,
      endDate: monthEnd, createdByUserAccountId: accountId,
    }).onConflictDoNothing();

    for (let date = 1; date <= day; date += 1) {
      const workDate = `${year}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
      if (new Date(`${workDate}T00:00:00Z`).getUTCDay() === 0) continue;
      await transaction.insert(workDayRecords).values({
        employeeId: demoEmployeeId, branchId: demoBranchId, workDate, status: "present",
        lateMinutes: 0, isDeductible: false, entrySource: "manual", createdByUserAccountId: accountId,
      }).onConflictDoNothing();
    }
  });

  console.log("Seeded development C4 fixtures: accounts, assignment, schedule, payroll configuration, and attendance.");
};

try {
  await seed();
} finally {
  await closeDatabase();
}
