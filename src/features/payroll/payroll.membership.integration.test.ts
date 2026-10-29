import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { calculatePayroll } from "./calculation/payroll-calculator";

const databaseTest = process.env.TEST_DATABASE_URL ? test : test.skip;
databaseTest("effective member days and last employment snapshot persist while legacy locked records remain immutable", async () => {
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  const key = `MEM-${randomUUID().slice(0,8)}`;
  const one = async (query: string, values: unknown[] = []): Promise<number> => Number((await client.query(query, values)).rows[0].id);
  try {
    await client.query("begin");
    const shop = await one("insert into shops(code,name) values($1,'Membership') returning id", [key]);
    const branch = await one("insert into branches(shop_id,code,name) values($1,'A','A') returning id", [shop]);
    const department = await one("insert into departments(branch_id,code,name) values($1,'A','A') returning id", [branch]);
    const position = await one("insert into positions(shop_id,code,name) values($1,'A','A') returning id", [shop]);
    const employee = await one("insert into employees(employee_code,passport_id,first_name,last_name,hire_date,status,terminated_at) values($1,$1,'Member','History','2097-09-01','terminated','2097-09-20') returning id", [key]);
    const actor = await one("insert into user_accounts(username,password_hash) values($1,'fixture') returning id", [key]);
    await client.query("insert into employment_assignments(employee_id,branch_id,department_id,position_id,base_salary,welfare_amount,effective_from,effective_to,is_social_security_member) values($1,$2,$3,$4,'30000.00','3000.00','2097-09-01','2097-09-10',true)", [employee,branch,department,position]);
    const lastAssignment = await one("insert into employment_assignments(employee_id,branch_id,department_id,position_id,base_salary,welfare_amount,effective_from,effective_to,is_social_security_member) values($1,$2,$3,$4,'60000.00','3000.00','2097-09-11','2097-09-20',false) returning id", [employee,branch,department,position]);
    await client.query("insert into branch_schedules(branch_id,work_start_time,effective_from) values($1,'09:00','2097-09-01')", [branch]);
    for (const [name,value,unit] of [["STANDARD_WORK_DAYS","30","days"],["ABSENCE_RATE","1","multiplier"],["LATE_RATE","2","currency_per_minute"],["SOCIAL_SECURITY_RATE","0.05","ratio"],["SOCIAL_SECURITY_CAP","750","currency"]]) await client.query("insert into payroll_configurations(shop_id,config_key,numeric_value,unit,effective_from,created_by_user_account_id) values($1,$2,$3,$4,'2097-09-01',$5)", [shop,name,value,unit,actor]);
    const periodId = await one("insert into payroll_periods(shop_id,period_year,period_month,start_date,end_date,created_by_user_account_id) values($1,2097,9,'2097-09-01','2097-09-30',$2) returning id", [shop,actor]);
    await client.query("insert into work_day_records(employee_id,branch_id,work_date,status,is_deductible,entry_source) select $1,$2,d::date,'present',false,'manual' from generate_series('2097-09-01'::date,'2097-09-20'::date,'1 day') d", [employee,branch]);
    const schema = await import("../../db/schema");
    const { DrizzlePayrollInputProvider, createPayrollRepositorySession } = await import("./payroll.repository");
    const session = createPayrollRepositorySession(drizzle(client, { schema }));
    const period = (await session.findPeriod(String(periodId)))!;
    const loaded = await new DrizzlePayrollInputProvider().load(session, period);
    expect(loaded.blockers).toEqual([]);
    const input = loaded.inputs[0]!;
    expect(input.assignmentId).toBe(String(lastAssignment));
    expect(input.isSocialSecurityMember).toBe(false);
    expect(input.workDays.filter(day => day.isSocialSecurityMember)).toHaveLength(10);
    const calculated = calculatePayroll(input);
    expect(calculated.socialSecurityBaseSnapshot).toBe("15000.00");
    expect(calculated.items.find(item => item.itemType === "social_security")?.amount).toBe("750.00");
    await session.replaceCalculatedRecords(String(periodId), [calculated], String(actor), false);
    const stored = (await client.query("select id,social_security_base_snapshot,is_social_security_member_snapshot,net_pay from payroll_records where payroll_period_id=$1", [periodId])).rows[0];
    expect(stored.social_security_base_snapshot).toBe("15000.00");
    expect(stored.is_social_security_member_snapshot).toBe(false);
    await client.query("update payroll_records set status='locked',locked_at=now() where id=$1", [stored.id]);
    // A later effective assignment cannot reinterpret the already frozen result.
    await client.query("insert into employment_assignments(employee_id,branch_id,department_id,position_id,base_salary,effective_from,is_social_security_member) values($1,$2,$3,$4,'90000','2097-10-01',true)", [employee,branch,department,position]);
    expect((await client.query("select social_security_base_snapshot,is_social_security_member_snapshot,net_pay from payroll_records where id=$1", [stored.id])).rows[0]).toEqual({ social_security_base_snapshot: "15000.00", is_social_security_member_snapshot: false, net_pay: stored.net_pay });
    await client.query("savepoint immutable");
    await expect(client.query("update payroll_records set social_security_base_snapshot=0 where id=$1", [stored.id])).rejects.toBeDefined();
    await client.query("rollback to savepoint immutable");
    // A legacy row can retain unknown earned base; no invented zero/monthly base.
    const legacy = await one("insert into payroll_periods(shop_id,period_year,period_month,start_date,end_date,created_by_user_account_id) values($1,2097,8,'2097-08-01','2097-08-31',$2) returning id", [shop,actor]);
    const legacyRecord = await one("insert into payroll_records(payroll_period_id,employee_id,employment_assignment_id,status,base_salary_snapshot,welfare_snapshot,total_earnings,total_deductions,net_pay,locked_at) values($1,$2,$3,'locked',30000,0,1000,50,950,now()) returning id", [legacy,employee,lastAssignment]);
    expect((await client.query("select social_security_base_snapshot,is_social_security_member_snapshot,net_pay from payroll_records where id=$1", [legacyRecord])).rows[0]).toEqual({ social_security_base_snapshot: null, is_social_security_member_snapshot: true, net_pay: "950.00" });
  } finally { await client.query("rollback"); await client.end(); }
});
