// Test-only fixture command; never imported by application composition.
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";
import { hashPassword } from "../../core/auth/password";
import { ActionObserver } from "../../core/audit/action-observer";
import { auditRepository } from "../audit/audit.repository";
import { createReportService } from "../reports/report.service";
import { reportTestCipher } from "../reports/report.test-support";

if (import.meta.main) {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "http://missing");
  if (process.env.RELEASE_DISPOSABLE_DB !== "1" || !["postgres", "127.0.0.1", "localhost"].includes(url.hostname)
    || (url.hostname !== "postgres" && url.port !== "55440")) throw new Error("Explicit disposable verification database required");
  const pool = new Pool({ connectionString: url.toString() });
  const directory = process.env.PAYSLIP_FIXTURE_DIR ?? "/tmp/haris-task10";
  try {
    const client = await pool.connect();
    const one = async (sql: string, values: unknown[] = []) => String((await client.query(sql, values)).rows[0].id);
    let fixture;
    try {
      await client.query("begin");
      const key = `SLIP-${randomUUID().slice(0, 8)}`;
      const hr = await one("select id from user_accounts where username='hr'");
      const shopId = await one("insert into shops(code,name) values($1,$1) returning id", [key]);
      const branchId = await one("insert into branches(shop_id,code,name) values($1,'SLIP','สาขาสลิปทดสอบ') returning id", [shopId]);
      const departmentId = await one("insert into departments(branch_id,code,name) values($1,'SLIP','แผนกสลิปทดสอบ') returning id", [branchId]);
      const positionId = await one("insert into positions(shop_id,code,name) values($1,'SLIP','พนักงานทดสอบ') returning id", [shopId]);
      const periodId = await one("insert into payroll_periods(shop_id,period_year,period_month,start_date,end_date,created_by_user_account_id) values($1,2097,10,'2097-10-01','2097-10-31',$2) returning id", [shopId, hr]);
      const employees = [];
      const cases = [
        { role: "EMPLOYEE", base: "12000.00", adjustment: "100.37", deductions: "600.00", earnings: "12100.37", net: "11500.37", member: true },
        { role: "EMPLOYEE", base: "4000.00", adjustment: "0.25", deductions: "200.00", earnings: "4000.25", net: "3800.25", member: false },
        { role: "SUPERVISOR", base: "1000.00", adjustment: "0.01", deductions: "50.00", earnings: "1000.01", net: "950.01", member: true },
        { role: "BRANCH_MANAGER", base: "2000.00", adjustment: "0.02", deductions: "100.00", earnings: "2000.02", net: "1900.02", member: true },
      ];
      const passwordHash = await hashPassword("password");
      for (const [index, values] of cases.entries()) {
        const code = `${key}-${index}`, username = code.toLowerCase();
        const employeeId = await one("insert into employees(employee_code,passport_id,first_name,last_name,hire_date,payment_method) values($1,$1,$2,'ทดสอบ','2097-01-01','cash') returning id", [code, `พนักงานสลิป ${index + 1}`]);
        const assignmentId = await one("insert into employment_assignments(employee_id,branch_id,department_id,position_id,base_salary,effective_from,is_social_security_member) values($1,$2,$3,$4,30000,'2097-01-01',$5) returning id", [employeeId, branchId, departmentId, positionId, values.member]);
        const accountId = await one("insert into user_accounts(employee_id,username,password_hash) values($1,$2,$3) returning id", [employeeId, username, passwordHash]);
        await client.query("insert into user_account_roles(user_account_id,role_id,branch_id,department_id,granted_by_user_account_id) select $1,id,$3,$4,$5 from roles where code=$2", [accountId, values.role, index >= 2 ? branchId : null, index === 2 ? departmentId : null, hr]);
        const recordId = await one("insert into payroll_records(payroll_period_id,employee_id,employment_assignment_id,is_social_security_member_snapshot,social_security_base_snapshot,base_salary_snapshot,total_earnings,total_deductions,net_pay) values($1,$2,$3,$4,$5,30000,$6,$7,$8) returning id", [periodId, employeeId, assignmentId, values.member, values.base, values.earnings, values.deductions, values.net]);
        await client.query("insert into payroll_items(payroll_record_id,item_type,direction,description,amount) values($1,'base_salary','earning','Frozen daily base',$2),($1,'adjustment','earning','Frozen adjustment',$3),($1,'social_security','deduction','Frozen SS',$4)", [recordId, values.base, values.adjustment, values.deductions]);
        await client.query("update payroll_records set status='locked',locked_at=now() where id=$1", [recordId]);
        employees.push({ id: employeeId, recordId, code, username, ...values });
      }
      await client.query("update payroll_periods set status='locked',locked_at=now(),locked_by_user_account_id=$2 where id=$1", [periodId, hr]);
      await client.query("commit");
      fixture = { key, shopId, branchId, departmentId, periodId, employees, hr };
    } catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
    const db = drizzle({ client: pool, schema });
    const report = await createReportService({ rootExecutor: db, actions: new ActionObserver(db, auditRepository), cipher: reportTestCipher() }).salaryPayable({ accountId: fixture.hr, employeeId: null, username: "hr", grants: [{ grantId: "1", roleCode: "HR", scope: "all", branchId: null, departmentId: null }] }, fixture.periodId, randomUUID());
    mkdirSync(directory, { recursive: true });
    writeFileSync(`${directory}/fixture.json`, JSON.stringify({ ...fixture, report }, null, 2));
    console.log(JSON.stringify({ fixture: `${directory}/fixture.json`, period: fixture.periodId, totals: report.totals }));
  } finally { await pool.end(); }
}
