import { and, eq } from "drizzle-orm";
import { db, closeDatabase } from "../core/db/client";
import { hashPassword } from "../core/auth/password";
import { SYSTEM_ROLES } from "../features/role/role.bootstrap";
import { roles } from "../features/role/role.schema";
import { shops } from "../features/shop/shop.schema";
import { branches } from "../features/branch/branch.schema";
import { departments } from "../features/department/department.schema";
import { positions } from "../features/position/position.schema";
import { employees } from "../features/employee/employee.schema";
import { employmentAssignments } from "../features/employment-assignment/employment-assignment.schema";
import { employeeWeeklyHolidays } from "../features/employee-weekly-holiday/employee-weekly-holiday.schema";
import { employeeBankAccounts } from "../features/employee-bank-account/employee-bank-account.schema";
import { createBankAccountCipher, bankKeyringFromEnv } from "../features/employee-bank-account/employee-bank-account.crypto";
import { userAccounts, userAccountRoles } from "../features/user-account/user-account.schema";
import { branchSchedules } from "../features/branch-schedule/branch-schedule.schema";
import { workDayRecords } from "../features/attendance/attendance.schema";
import { overtimeRecords } from "../features/overtime/overtime.schema";
import { leaveTypes, leaveQuotas } from "../features/leave/leave.schema";
import { payrollConfigurations, payrollPeriods } from "../features/payroll/payroll.schema";
import { presentationBranches, presentationEmployees } from "./presentation-data";
import { sameLeavePolicy } from "./leave-consolidation";

const SHOP_CODE = "HARIS-PRESENTATION";
const PASSWORD = "HarisDemo2026!";
const PRESENTATION_BANKS = [
  { bankCode: "002", bankName: "ธนาคารกรุงเทพ" },
  { bankCode: "004", bankName: "ธนาคารกสิกรไทย" },
  { bankCode: "006", bankName: "ธนาคารกรุงไทย" },
  { bankCode: "014", bankName: "ธนาคารไทยพาณิชย์" },
] as const;

async function seed() {
  if (process.env.NODE_ENV === "production") throw new Error("Presentation seed is development only");
  const bangkok = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [currentYear, currentMonth] = bangkok.split("-").map(Number) as [number, number];
  const monthEnd = new Date(Date.UTC(currentYear, currentMonth - 1, 0)).toISOString().slice(0, 10);
  const monthStart = `${monthEnd.slice(0, 7)}-01`;
  const year = Number(monthStart.slice(0, 4));
  const month = Number(monthStart.slice(5, 7));
  const days = Number(monthEnd.slice(8));
  const effectiveFrom = `${year}-01-01`;
  const passwordHash = await hashPassword(PASSWORD);
  const cipher = createBankAccountCipher(bankKeyringFromEnv());

  await db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: shops.id }).from(shops).where(eq(shops.code, SHOP_CODE));
    if (existing) { console.log("Presentation data exists; preserving existing records."); return; }
    for (const role of SYSTEM_ROLES) await tx.insert(roles).values(role).onConflictDoNothing();
    const roleRows = await tx.select().from(roles);
    const roleId = (code: string) => {
      const role = roleRows.find((row) => row.code === code && row.isActive);
      if (!role) throw new Error(`Role unavailable: ${code}`);
      return role.id;
    };
    const [shop] = await tx.insert(shops).values({ code: SHOP_CODE, name: "Haris" }).returning();
    if (!shop) throw new Error("Cannot create presentation shop");
    const [owner] = await tx.insert(userAccounts).values({ username: "haris_owner", passwordHash }).returning();
    if (!owner) throw new Error("Cannot create presentation owner");
    await tx.insert(userAccountRoles).values({ userAccountId: owner.id, roleId: roleId("OWNER") });
    const [hr] = await tx.insert(userAccounts).values({ username: "haris_hr", passwordHash }).returning();
    if (!hr) throw new Error("Cannot create presentation HR");
    await tx.insert(userAccountRoles).values({ userAccountId: hr.id, roleId: roleId("HR"), grantedByUserAccountId: owner.id });
    const [position] = await tx.insert(positions).values({ shopId: shop.id, code: "STAFF", name: "พนักงานร้านอาหาร" }).returning();
    if (!position) throw new Error("Cannot create presentation position");
    const leaveRows = [];
    for (const entry of [
      { code: "HARIS-SICK", nameTh: "ลาป่วย", quotaDays: "30" },
      { code: "HARIS-PERSONAL", nameTh: "ลากิจ", quotaDays: "3" },
      { code: "HARIS-ANNUAL", nameTh: "ลาพักร้อน", quotaDays: "6" },
    ]) {
      const policy = { ...entry, quotaType: "fixed" as const, isDeductible: false, requiresDocument: false, allowExceed: false };
      const existingTypes = await tx.select().from(leaveTypes).where(and(eq(leaveTypes.nameTh, entry.nameTh), eq(leaveTypes.isActive, true)));
      const type = existingTypes.find((row) => sameLeavePolicy(row, policy)) ?? (await tx.insert(leaveTypes).values(policy).returning())[0];
      if (!type) throw new Error("Cannot create leave type");
      leaveRows.push(type);
    }
    const config = [
      ["ABSENCE_RATE", "1", "multiplier"], ["LATE_RATE", "2", "currency_per_minute"],
      ["SOCIAL_SECURITY_RATE", "0.05", "ratio"], ["SOCIAL_SECURITY_CAP", "750", "currency"],
      ["OT_HOURLY_RATE", "1.5", "multiplier"], ["OT_REST_DAY_RATE", "1", "multiplier"],
      ["OT_PUBLIC_HOLIDAY_RATE", "2", "multiplier"],
    ] as const;
    for (const [branchIndex, branchData] of presentationBranches.entries()) {
      const [branch] = await tx.insert(branches).values({ shopId: shop.id, ...branchData }).returning();
      if (!branch) throw new Error("Cannot create branch");
      const [department] = await tx.insert(departments).values({ branchId: branch.id, code: "SERVICE", name: "ฝ่ายบริการหน้าร้าน" }).returning();
      if (!department) throw new Error("Cannot create department");
      await tx.insert(branchSchedules).values({ branchId: branch.id, workStartTime: "09:00:00", standardCloseTime: "18:00:00", lateGraceMinutes: 10, effectiveFrom });
      for (const [configKey, numericValue, unit] of config) await tx.insert(payrollConfigurations).values({ shopId: shop.id, branchId: branch.id, configKey, numericValue, unit, effectiveFrom, createdByUserAccountId: owner.id });
      for (const [index, person] of presentationEmployees.filter((row) => row.branchCode === branch.code).entries()) {
        const category = (["cash", "transfer", "social_security"] as const)[index % 3]!;
        const [employee] = await tx.insert(employees).values({ employeeCode: person.code, passportId: `HARIS-${branch.code}-${index + 1}`, firstName: person.firstName, lastName: person.lastName, hireDate: effectiveFrom, paymentCategory: category, paymentMethod: category === "cash" ? "cash" : "transfer", promptpayPhone: `08${String(branchIndex * 20 + index + 1).padStart(8, "0")}`, personalEmail: `${person.code.toLowerCase()}@example.test` }).returning();
        if (!employee) throw new Error("Cannot create employee");
        await tx.insert(employmentAssignments).values({ employeeId: employee.id, branchId: branch.id, departmentId: department.id, positionId: position.id, baseSalary: String(15000 + (index % 5) * 1500), welfareAmount: "1000", effectiveFrom, createdByUserAccountId: owner.id });
        await tx.insert(employeeWeeklyHolidays).values({ employeeId: employee.id, weekday: 0, effectiveFrom });
        const bank = PRESENTATION_BANKS[index % PRESENTATION_BANKS.length]!;
        const accountNumberLast4 = String(branchIndex * 20 + index + 1).padStart(4, "0");
        await tx.insert(employeeBankAccounts).values({ employeeId: employee.id, ...bank, accountHolderName: `${person.firstName} ${person.lastName}`, accountNumberCiphertext: await cipher.encrypt(`000000${accountNumberLast4}`), accountNumberLast4 });
        for (const leave of leaveRows) for (const quotaYear of new Set([year, currentYear])) await tx.insert(leaveQuotas).values({ employeeId: employee.id, leaveTypeId: leave.id, quotaYear, entitledDays: leave.quotaDays ?? "0" });
        for (let date = 1; date <= days; date++) {
          const workDate = `${monthStart.slice(0, 7)}-${String(date).padStart(2, "0")}`;
          if (new Date(`${workDate}T12:00:00Z`).getUTCDay() === 0) continue;
          await tx.insert(workDayRecords).values({ employeeId: employee.id, branchId: branch.id, workDate, clockInAt: new Date(`${workDate}T09:00:00+07:00`), clockOutAt: new Date(`${workDate}T18:00:00+07:00`), status: "present", lateMinutes: 0, isDeductible: false, entrySource: "manual", createdByUserAccountId: owner.id });
        }
        if (branchIndex === 0 && index === 0) {
          await tx.insert(overtimeRecords).values({ employeeId: employee.id, overtimeDate: bangkok, overtimeType: "hourly", hours: "2", reason: "จัดเตรียมร้านหลังปิดบริการ", requestedByUserAccountId: owner.id });
          const [account] = await tx.insert(userAccounts).values({ username: "haris_employee", passwordHash, employeeId: employee.id }).returning();
          if (!account) throw new Error("Cannot create employee account");
          await tx.insert(userAccountRoles).values({ userAccountId: account.id, roleId: roleId("EMPLOYEE"), grantedByUserAccountId: owner.id });
        }
      }
      if (branchIndex === 0) {
        for (const [username, roleCode, departmentId] of [["haris_manager", "BRANCH_MANAGER", null], ["haris_supervisor", "SUPERVISOR", department.id]] as const) {
          const [account] = await tx.insert(userAccounts).values({ username, passwordHash }).returning();
          if (!account) throw new Error("Cannot create staff account");
          await tx.insert(userAccountRoles).values({ userAccountId: account.id, roleId: roleId(roleCode), branchId: branch.id, departmentId, grantedByUserAccountId: owner.id });
        }
      }
    }
    await tx.insert(payrollPeriods).values({ shopId: shop.id, periodYear: year, periodMonth: month, startDate: monthStart, endDate: monthEnd, createdByUserAccountId: owner.id });
    console.log(`Presentation seed created: Haris, 3 branches, 60 employees, period ${monthStart}–${monthEnd}.`);
  });
}

try { await seed(); } finally { await closeDatabase(); }
