import { expect, test } from "bun:test";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { ActionObserver } from "../../core/audit/action-observer";
import { DomainAuditObserver } from "../../core/audit/domain-audit-observer";
import type { DatabaseExecutor, TransactionRunner } from "../../core/db/transaction";
import { auditRepository } from "../audit/audit.repository";
import { employeePaymentRepository } from "./employee.repository";
import { createEmployeeService } from "./employee.service";
import { employeeTestActor } from "./employee.test-support";

const databaseTest = process.env.TEST_DATABASE_URL ? test : test.skip;
const gate = () => { let open!: () => void; const promise = new Promise<void>(resolve => { open = resolve; }); return { promise, open }; };

databaseTest("concurrent destination saves audit the preceding committed destination", async () => {
  const clients = [0, 1, 2].map(() => new Client({ connectionString: process.env.TEST_DATABASE_URL }));
  await Promise.all(clients.map(client => client.connect()));
  const [first, second, control] = clients as [Client, Client, Client];
  const readFirst = gate(); const resumeFirst = gate(); const firstCommitted = gate();
  const pending: Promise<unknown>[] = [];
  let secondRead = false;
  const key = `DEST-${crypto.randomUUID().slice(0, 20)}`;
  try {
    const employeeId = String((await control.query("insert into employees(employee_code,passport_id,first_name,last_name,hire_date) values($1,$1,'Destination','Race','2096-01-01') returning id", [key])).rows[0].id);
    const accountId = String((await control.query("select id from user_accounts order by id limit 1")).rows[0].id);
    const actor = { ...employeeTestActor("HR"), accountId };
    const makeService = (client: Client, isFirst: boolean) => {
      const executor = drizzle(client) as unknown as DatabaseExecutor;
      const transactionRunner: TransactionRunner = { async transaction(work) {
        await client.query("begin");
        try { const value = await work(executor as never); await client.query("commit"); return value; }
        catch (error) { await client.query("rollback"); throw error; }
      } };
      return createEmployeeService({ rootExecutor: executor, transactionRunner, payroll: { async serialize() {} },
        actions: new ActionObserver(executor, auditRepository), domain: new DomainAuditObserver(auditRepository),
        paymentRepository: { ...employeePaymentRepository, async findPaymentDestination(...args) {
          const value = await employeePaymentRepository.findPaymentDestination(...args);
          if (isFirst) { readFirst.open(); await resumeFirst.promise; }
          else { secondRead = true; await firstCommitted.promise; }
          return value;
        } },
      });
    };
    const a = makeService(first, true).updatePaymentDestination({ actor, requestId: `${key}-A`, employeeId, paymentMethod: "transfer", promptpayPhone: "0812345678" });
    pending.push(a); await readFirst.promise;
    const b = makeService(second, false).updatePaymentDestination({ actor, requestId: `${key}-B`, employeeId, paymentMethod: "cash", promptpayPhone: null });
    pending.push(b);
    // Establish either the old stale read or a real PostgreSQL lock wait before A proceeds.
    let observedOverlap = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      const waiting = (await control.query("select cardinality(pg_blocking_pids($1)) > 0 as waiting", [(second as unknown as { processID: number }).processID])).rows[0].waiting;
      if (secondRead || waiting) { observedOverlap = true; break; }
      await Bun.sleep(10);
    }
    expect(observedOverlap).toBe(true);
    expect(secondRead).toBe(false);
    // GET remains an ordinary nonblocking read while A holds the mutation lock.
    const visible = await employeePaymentRepository.findPaymentDestination(drizzle(control) as unknown as DatabaseExecutor, employeeId);
    expect(visible).toEqual({ paymentMethod: "cash", promptpayPhone: null });
    resumeFirst.open(); await a; firstCommitted.open(); await b;
    const audits = (await control.query("select old_data,new_data from audit_logs where request_id in ($1,$2) and action='employee.payment_destination.update.succeeded' order by id", [`${key}-A`, `${key}-B`])).rows;
    expect(audits).toHaveLength(2);
    expect(audits[0]).toEqual({ old_data: { payment_method: "cash", has_promptpay_phone: false }, new_data: { payment_method: "transfer", has_promptpay_phone: true } });
    expect(audits[1].old_data).toEqual(audits[0].new_data);
    expect(audits[1].new_data).toEqual({ payment_method: "cash", has_promptpay_phone: false });
    expect((await control.query("select payment_method,promptpay_phone from employees where id=$1", [employeeId])).rows[0]).toEqual({ payment_method: "cash", promptpay_phone: null });
  } finally {
    resumeFirst.open(); firstCommitted.open();
    await Promise.allSettled(pending);
    await Promise.all(clients.map(client => client.end()));
  }
}, 15000);
