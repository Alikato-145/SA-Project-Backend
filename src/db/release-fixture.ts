import { and, eq } from "drizzle-orm";
import { db, closeDatabase } from "../core/db/client";
import { hashPassword } from "../core/auth/password";
import { createBankAccountCipher, bankKeyringFromEnv } from "../features/employee-bank-account/employee-bank-account.crypto";
import { employeeBankAccounts } from "../features/employee-bank-account/employee-bank-account.schema";
import { shops } from "../features/shop/shop.schema";
import { branches } from "../features/branch/branch.schema";
import { departments } from "../features/department/department.schema";
import { positions } from "../features/position/position.schema";
import { employees } from "../features/employee/employee.schema";
import { employmentAssignments } from "../features/employment-assignment/employment-assignment.schema";
import { employeeWeeklyHolidays } from "../features/employee-weekly-holiday/employee-weekly-holiday.schema";
import { branchSchedules } from "../features/branch-schedule/branch-schedule.schema";
import { holidayCalendars } from "../features/holiday-calendar/holiday-calendar.schema";
import { payrollConfigurations } from "../features/payroll/payroll.schema";
import { workDayRecords } from "../features/attendance/attendance.schema";
import { leaveQuotas, leaveTypes } from "../features/leave/leave.schema";
import { userAccounts, userAccountRoles } from "../features/user-account/user-account.schema";
import { roles } from "../features/role/role.schema";

try {
  if (process.env.NODE_ENV === "production" || process.env.RELEASE_DISPOSABLE_DB !== "1" ||
    !process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
    throw new Error("Release fixtures require matching disposable DATABASE_URL/TEST_DATABASE_URL and RELEASE_DISPOSABLE_DB=1.");
  }
  const child = Bun.spawn([process.execPath, "run", "db:seed"], {
    env: { ...process.env, SEED_AS_OF_DATE: "2026-09-30" }, stdout: "inherit", stderr: "inherit",
  });
  if (await child.exited !== 0) throw new Error("Base fixture failed.");
  const cipher = createBankAccountCipher(bankKeyringFromEnv());
  await db.transaction(async (tx) => {
    const [shop] = await tx.select().from(shops).where(eq(shops.code, "DEMO"));
    const [owner] = await tx.select().from(userAccounts).where(eq(userAccounts.username, "admin"));
    const [position] = await tx.select().from(positions).where(and(eq(positions.shopId, shop!.id), eq(positions.code, "DEMO-STAFF")));
    const [baseBranch] = await tx.select().from(branches).where(and(eq(branches.shopId, shop!.id), eq(branches.code, "DEMO-BKK")));
    await tx.insert(branches).values({ shopId: shop!.id, code: "DEMO-CNX", name: "สาขาทดสอบ เชียงใหม่" }).onConflictDoNothing();
    const [otherBranch] = await tx.select().from(branches).where(and(eq(branches.shopId, shop!.id), eq(branches.code, "DEMO-CNX")));
    const configs = await tx.select().from(payrollConfigurations).where(eq(payrollConfigurations.branchId, baseBranch!.id));
    for (const config of configs) await tx.insert(payrollConfigurations).values({
      shopId: shop!.id, branchId: otherBranch!.id, configKey: config.configKey,
      numericValue: config.numericValue, unit: config.unit, effectiveFrom: "2026-01-01", createdByUserAccountId: owner!.id,
    }).onConflictDoNothing();
    await tx.insert(branchSchedules).values({ branchId: otherBranch!.id, workStartTime: "09:00:00", standardCloseTime: "18:00:00", lateGraceMinutes: 10, effectiveFrom: "2026-01-01" }).onConflictDoNothing();
    await tx.insert(holidayCalendars).values({ shopId: shop!.id, holidayDate: "2026-10-23", name: "วันหยุดตัวอย่าง", createdByUserAccountId: owner!.id }).onConflictDoNothing();
    const [employeeRole] = await tx.select().from(roles).where(eq(roles.code, "EMPLOYEE"));
    const quotaTypes = await tx.select().from(leaveTypes).where(eq(leaveTypes.quotaType, "fixed"));
    for (const [index, branch] of [baseBranch!, otherBranch!].entries()) {
      const code = `RELEASE-${index + 1}`;
      await tx.insert(departments).values({ branchId: branch.id, code: "DEMO-KITCHEN", name: "แผนกครัวทดสอบ" }).onConflictDoNothing();
      const [department] = await tx.select().from(departments).where(and(eq(departments.branchId, branch.id), eq(departments.code, "DEMO-KITCHEN")));
      await tx.insert(employees).values({ employeeCode: code, passportId: `DEMO-${code}`, firstName: "พนักงานทดสอบ", lastName: code, hireDate: "2026-01-01" }).onConflictDoNothing();
      const [employee] = await tx.select().from(employees).where(eq(employees.employeeCode, code));
      await tx.insert(employmentAssignments).values({ employeeId: employee!.id, branchId: branch.id, departmentId: department!.id, positionId: position!.id, baseSalary: "20000.00", welfareAmount: "1000.00", effectiveFrom: "2026-01-01", createdByUserAccountId: owner!.id }).onConflictDoNothing();
      await tx.insert(employeeWeeklyHolidays).values({ employeeId: employee!.id, weekday: 0, effectiveFrom: "2026-01-01" }).onConflictDoNothing();
      await tx.insert(userAccounts).values({ username: `employee_other_${index + 1}`, employeeId: employee!.id, passwordHash: await hashPassword("password") }).onConflictDoNothing();
      const [account] = await tx.select().from(userAccounts).where(eq(userAccounts.username, `employee_other_${index + 1}`));
      if (account!.employeeId !== employee!.id) throw new Error("Unexpected release account linkage.");
      await tx.insert(userAccountRoles).values({ userAccountId: account!.id, roleId: employeeRole!.id, grantedByUserAccountId: owner!.id }).onConflictDoNothing();
      for (const type of quotaTypes) await tx.insert(leaveQuotas).values({ employeeId: employee!.id, leaveTypeId: type.id, quotaYear: 2026, entitledDays: type.quotaDays ?? "0" }).onConflictDoNothing();
      for (let day = 1; day <= 30; day++) {
        const date = `2026-09-${String(day).padStart(2, "0")}`;
        if (new Date(`${date}T12:00:00Z`).getUTCDay() === 0) continue;
        await tx.insert(workDayRecords).values({ employeeId: employee!.id, branchId: branch.id, workDate: date, status: "present", isDeductible: false, createdByUserAccountId: owner!.id }).onConflictDoNothing();
      }
    }
    const fixtureEmployees = await tx.select().from(employees);
    for (const employee of fixtureEmployees.filter((e) => e.employeeCode === "DEMO-EMPLOYEE" || e.employeeCode.startsWith("RELEASE-"))) {
      const [existing] = await tx.select().from(employeeBankAccounts).where(and(eq(employeeBankAccounts.employeeId, employee.id), eq(employeeBankAccounts.bankCode, "DEMO")));
      if (!existing) await tx.insert(employeeBankAccounts).values({ employeeId: employee.id, bankCode: "DEMO", bankName: "ธนาคารทดสอบ", accountHolderName: `Demo ${employee.employeeCode}`, accountNumberCiphertext: await cipher.encrypt("0000000000"), accountNumberLast4: "0000" });
    }
  });
  console.log("Release fixture ready: 2026-09, two branches, separate departments and scoped actors. All money/rates/bank data are synthetic.");
} finally { await closeDatabase(); }
