import { expect, test } from "bun:test";
import { Client, Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";
import type { DatabaseExecutor, TransactionRunner } from "../../core/db/transaction";
import { ActionObserver } from "../../core/audit/action-observer";
import { DomainAuditObserver } from "../../core/audit/domain-audit-observer";
import { auditRepository } from "../audit/audit.repository";
import { createEmployeeService } from "../employee/employee.service";
import { createPayrollPaymentService } from "./payroll-payment.service";
import { payrollPaymentRepository } from "./payroll-payment.repository";
import { seedPaymentFixture } from "./payroll-payment.test-support";
import { payrollActor } from "./payroll.test-support";
const databaseTest = process.env.TEST_DATABASE_URL ? test : test.skip;
const gate = () => { let open!: () => void; const promise = new Promise<void>(resolve => { open = resolve; }); return { promise, open }; };

for (const secondOperation of ["list", "prepare"] as const) {
  databaseTest(`reversed historical branch order: concurrent list/${secondOperation} both complete`, async () => {
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const clients = [new Client({ connectionString: process.env.TEST_DATABASE_URL }), new Client({ connectionString: process.env.TEST_DATABASE_URL })];
    await Promise.all(clients.map(client => client.connect()));
    const release = gate(), firstRead = gate();
    const pending: Promise<unknown>[] = [];
    let secondRead = false;
    try {
      const f = await seedPaymentFixture(pool);
      const employees = [f.employees[0]!, f.employees[4]!];
      await pool.query("update employees set payment_method='cash',promptpay_phone=null where id=any($1::bigint[])", [employees.map(e => e.id)]);
      const periodId = String((await pool.query("insert into payroll_periods(shop_id,period_year,period_month,start_date,end_date,status,created_by_user_account_id,locked_by_user_account_id,locked_at) values($1,2095,11,'2095-11-01','2095-11-30','locked',$2,$2,now()) returning id", [f.shopId, f.actorId])).rows[0].id);
      for (const [index, employee] of employees.entries()) {
        const assignment = (await pool.query("select employment_assignment_id from payroll_records where id=$1", [employee.recordId])).rows[0].employment_assignment_id;
        await pool.query("update employment_assignments set effective_to='2095-10-31' where id=$1", [assignment]);
        const branchId = f.branches[1 - index]!;
        const next = (await pool.query("insert into employment_assignments(employee_id,branch_id,department_id,position_id,base_salary,effective_from,is_social_security_member) select employee_id,$2,(select id from departments where branch_id=$2 limit 1),position_id,30000,'2095-11-01',false from employment_assignments where id=$1 returning id", [assignment, branchId])).rows[0].id;
        await pool.query("insert into payroll_records(payroll_period_id,employee_id,employment_assignment_id,status,is_social_security_member_snapshot,base_salary_snapshot,total_earnings,total_deductions,net_pay,locked_at) values($1,$2,$3,'locked',false,30000,100.01,0,100.01,now())", [periodId, employee.id, next]);
      }
      const root = drizzle(pool, { schema });
      const actions = new ActionObserver(root, auditRepository), domain = new DomainAuditObserver(auditRepository);
      const actor = { ...payrollActor(), accountId: f.actorId };
      const makeService = (client: Client, index: number) => {
        const executor = drizzle(client, { schema });
        const transactionRunner: TransactionRunner = { async transaction(work) {
          await client.query("begin");
          try { const value = await work(executor as never); await client.query("commit"); return value; }
          catch (error) { await client.query("rollback"); throw error; }
        } };
        const employee = createEmployeeService({ rootExecutor: executor, transactionRunner, actions, domain, payroll: { async serialize() {} } });
        let reads = 0;
        return createPayrollPaymentService({ rootExecutor: root, transactionRunner, repository: payrollPaymentRepository, actions, domain,
          employee: { async getPaymentDestinationInTransaction(e: DatabaseExecutor, command) {
            const result = await employee.getPaymentDestinationInTransaction(e, command);
            if (++reads === 1) {
              if (index === 0) firstRead.open(); else secondRead = true;
              await release.promise;
            }
            return result;
          } }, bank: { async getPrimaryPaymentSnapshot() { return null; } },
        });
      };
      // A then B in October, B then A in November; both are real historical projections.
      const before = await payrollPaymentRepository.records(root, f.periodId);
      const after = await payrollPaymentRepository.records(root, periodId);
      expect(before[0]!.employeeId).toBe(employees[0]!.id);
      expect(after[0]!.employeeId).toBe(employees[1]!.id);
      const first = makeService(clients[0]!, 0).listPaymentGroups({ actor, requestId: `${f.key}-list`, periodId: f.periodId });
      pending.push(first); await firstRead.promise;
      const secondService = makeService(clients[1]!, 1);
      const command = { actor, requestId: `${f.key}-${secondOperation}`, periodId };
      const second = secondOperation === "list" ? secondService.listPaymentGroups(command) : secondService.preparePayrollPayments(command);
      pending.push(second);
      // Before the fix B is held by the second transaction. After it, the second
      // waits on the shared advisory lock before taking any employee row lock.
      let overlap = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const waiting = (await pool.query("select cardinality(pg_blocking_pids($1)) > 0 as waiting", [(clients[1] as unknown as { processID: number }).processID])).rows[0].waiting;
        if (secondRead || waiting) { overlap = true; break; }
        await Bun.sleep(10);
      }
      expect(overlap).toBe(true);
      release.open();
      const outcomes = await Promise.allSettled([first, second]);
      const failures = outcomes.flatMap(result => result.status === "rejected" ? [result.reason] : []);
      if (failures.length) console.log("reversed-period PostgreSQL failures", failures.map(error => ({ code: error.cause?.code ?? error.code, message: error.cause?.message ?? error.message })));
      expect(outcomes.map(result => result.status)).toEqual(["fulfilled", "fulfilled"]);
      if (secondOperation === "prepare") expect((await pool.query("select count(*) from payroll_payments p join payroll_records r on r.id=p.payroll_record_id where r.payroll_period_id=$1", [periodId])).rows[0].count).toBe("2");
    } finally {
      release.open(); await Promise.allSettled(pending);
      await Promise.all(clients.map(client => client.end())); await pool.end();
    }
  }, 15000);
}
