import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

const databaseTest = process.env.TEST_DATABASE_URL ? test : test.skip;
databaseTest("date-20 projection is conservative and failed final lock rolls back finance settlement", async () => {
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  const key = randomUUID().slice(0, 8);
  const one = async (query: string, values: unknown[] = []): Promise<number> => Number((await client.query(query, values)).rows[0].id);
  try {
    await client.query("begin");
    const shop = await one("insert into shops(code,name) values($1,'Projection') returning id", [`BP-${key}`]);
    const branch = await one("insert into branches(shop_id,code,name) values($1,'A','A') returning id", [shop]);
    const department = await one("insert into departments(branch_id,code,name) values($1,'K','K') returning id", [branch]);
    const position = await one("insert into positions(shop_id,code,name) values($1,'K','K') returning id", [shop]);
    const employee = await one("insert into employees(employee_code,passport_id,first_name,last_name,hire_date) values($1,$1,'Projection','Test','2098-09-01') returning id", [`BP-${key}`]);
    const actor = await one("insert into user_accounts(username,password_hash) values($1,'fixture') returning id", [`bp-${key}`]);
    await client.query("insert into employment_assignments(employee_id,branch_id,department_id,position_id,base_salary,effective_from) values($1,$2,$3,$4,'30000.00','2098-09-01')", [employee, branch, department, position]);
    await client.query("insert into branch_schedules(branch_id,work_start_time,effective_from) values($1,'09:00:00','2098-09-01')", [branch]);
    for (const [name, value, unit] of [["STANDARD_WORK_DAYS", "30", "days"], ["ABSENCE_RATE", "1", "multiplier"], ["LATE_RATE", "2", "currency_per_minute"], ["SOCIAL_SECURITY_RATE", "0", "ratio"], ["SOCIAL_SECURITY_CAP", "750", "currency"]]) {
      await client.query("insert into payroll_configurations(shop_id,config_key,numeric_value,unit,effective_from,created_by_user_account_id) values($1,$2,$3,$4,'2098-09-01',$5)", [shop, name, value, unit, actor]);
    }
    const periodId = await one("insert into payroll_periods(shop_id,period_year,period_month,start_date,end_date,created_by_user_account_id) values($1,2098,9,'2098-09-01','2098-09-30',$2) returning id", [shop, actor]);
    await client.query("insert into work_day_records(employee_id,branch_id,work_date,status,is_deductible,entry_source) select $1,$2,d::date,'present',false,'manual' from generate_series('2098-09-01'::date,'2098-09-20'::date,'1 day') d", [employee, branch]);
    const debtType = await one("insert into debt_types(code,name_th) values($1,'Projection debt') returning id", [`BP-${key}`]);
    const debtId = await one("insert into debt_transactions(employee_id,debt_type_id,transaction_date,description,amount,recorded_by_user_account_id) values($1,$2,'2098-09-25','Known monthly charge','50.00',$3) returning id", [employee, debtType, actor]);
    const loan = await one("insert into loans(employee_id,principal_amount,reason,installment_count,approved_by_user_account_id,approved_at) values($1,'100.00','Projection',1,$2,now()) returning id", [employee, actor]);
    const installment = await one("insert into loan_installments(loan_id,installment_no,due_period_start,amount) values($1,1,'2098-09-01','100.00') returning id", [loan]);
    const advance = await one("insert into advance_requests(employee_id,request_month,amount,status,requested_by_user_account_id) values($1,'2098-09-01','125.00','approved',$2) returning id", [employee, actor]);

    const schema = await import("../../db/schema");
    const { DrizzlePayrollInputProvider, DrizzlePayrollInputRepository, DrizzlePayrollRepository, createPayrollRepositorySession } = await import("./payroll.repository");
    const { createPayrollInputService, createPayrollService } = await import("./payroll.service");
    const executor = drizzle(client, { schema });
    const inputs = new DrizzlePayrollInputProvider();
    const inputService = createPayrollInputService(new DrizzlePayrollInputRepository(), inputs);
    const command = { employeeId: employee, date: "2098-09-20", amount: "5000.00" };
    // Only 20 earned days; all known monthly deductions, including the date-25 debt.
    expect(await inputService.projectAdvance(executor, command)).toBe("14725.00");
    const session = createPayrollRepositorySession(executor);
    const period = (await session.findPeriod(String(periodId)))!;
    expect((await inputs.load(session, period)).blockers).toContainEqual(expect.objectContaining({ code: "PAYROLL_ATTENDANCE_INCOMPLETE" }));
    await client.query("savepoint missing_prior");
    await client.query("delete from work_day_records where employee_id=$1 and work_date='2098-09-19'", [employee]);
    await expect(inputService.projectAdvance(executor, command)).rejects.toMatchObject({ code: "PAYROLL_ATTENDANCE_INCOMPLETE" });
    await client.query("rollback to savepoint missing_prior");
    await client.query("insert into work_day_records(employee_id,branch_id,work_date,status,is_deductible,entry_source) select $1,$2,d::date,'present',false,'manual' from generate_series('2098-09-21'::date,'2098-09-30'::date,'1 day') d", [employee, branch]);
    const repository = new DrizzlePayrollRepository();
    repository.withTransaction = async (work) => {
      await client.query("savepoint final_lock");
      try { const value = await work(session); await client.query("release savepoint final_lock"); return value; }
      catch (error) { await client.query("rollback to savepoint final_lock"); throw error; }
    };
    const service = createPayrollService({ repository, inputs, audit: { async record() { throw new Error("INJECTED_AUDIT_FAILURE_AFTER_SETTLEMENT"); } } });
    const payrollActor = { accountId: String(actor), employeeId: null, username: "test", grants: [{ grantId: "1", roleCode: "OWNER" as const, scope: "all" as const, branchId: null, departmentId: null }] };
    await expect(service.lockPayrollPeriod(payrollActor, String(periodId), "rollback-test")).rejects.toThrow("INJECTED_AUDIT_FAILURE_AFTER_SETTLEMENT");
    expect((await client.query("select status from payroll_periods where id=$1", [periodId])).rows[0].status).toBe("draft");
    expect((await client.query("select count(*)::int as n from payroll_records where payroll_period_id=$1", [periodId])).rows[0].n).toBe(0);
    expect((await client.query("select status from advance_requests where id=$1", [advance])).rows[0].status).toBe("approved");
    expect((await client.query("select status,payroll_record_id from loan_installments where id=$1", [installment])).rows[0]).toEqual({ status: "scheduled", payroll_record_id: null });
    expect((await client.query("select settled_at,settled_in_payroll_record_id from debt_transactions where id=$1", [debtId])).rows[0]).toEqual({ settled_at: null, settled_in_payroll_record_id: null });
    const successfulService = createPayrollService({ repository, inputs, audit: { async record() {} } });
    const locked = await successfulService.lockPayrollPeriod(payrollActor, String(periodId), "successful-lock");
    expect(locked.period.status).toBe("locked");
    expect(locked.records[0]!.netPay).toBe("29725.00");
    const stored = (await client.query("select id,status,locked_at from payroll_records where payroll_period_id=$1", [periodId])).rows[0];
    expect(stored.status).toBe("locked");
    expect(stored.locked_at).not.toBeNull();
    expect((await client.query("select count(*)::int as n from payroll_items where payroll_record_id=$1", [stored.id])).rows[0].n).toBeGreaterThan(30);
    expect((await client.query("select status from advance_requests where id=$1", [advance])).rows[0].status).toBe("deducted");
    expect((await client.query("select status from loan_installments where id=$1", [installment])).rows[0].status).toBe("deducted");
    expect((await client.query("select pi.payroll_record_id from payroll_items pi join payroll_records pr on pr.id=pi.payroll_record_id where pi.source_table='debt_transactions' and pi.source_id=$1 and pr.status='locked'", [debtId])).rows[0].payroll_record_id).toBe(String(stored.id));
    expect((await client.query("select settled_at,settled_in_payroll_record_id from debt_transactions where id=$1", [debtId])).rows[0]).toEqual({ settled_at: null, settled_in_payroll_record_id: null });
    expect(await inputService.getDebtSettlement(executor, debtId)).toMatchObject({ payrollRecordId: Number(stored.id) });
    const nextPeriodId = await one("insert into payroll_periods(shop_id,period_year,period_month,start_date,end_date,created_by_user_account_id) values($1,2098,10,'2098-10-01','2098-10-01',$2) returning id", [shop, actor]);
    await client.query("insert into work_day_records(employee_id,branch_id,work_date,status,is_deductible,entry_source) values($1,$2,'2098-10-01','present',false,'manual')", [employee, branch]);
    const nextInputs = await inputs.load(session, (await session.findPeriod(String(nextPeriodId)))!);
    expect(nextInputs.blockers).toEqual([]);
    expect(nextInputs.inputs[0]!.deductions).toEqual([]);
    await client.query("savepoint immutable_item");
    await expect(client.query("update payroll_items set amount='1.00' where payroll_record_id=$1", [stored.id])).rejects.toThrow();
    await client.query("rollback to savepoint immutable_item");
  } finally {
    await client.query("rollback");
    await client.end();
  }
});
