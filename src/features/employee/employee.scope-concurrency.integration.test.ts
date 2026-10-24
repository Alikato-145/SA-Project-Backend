import { expect, test } from "bun:test";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { ActionObserver } from "../../core/audit/action-observer";
import { DomainAuditObserver } from "../../core/audit/domain-audit-observer";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { DatabaseExecutor, TransactionRunner } from "../../core/db/transaction";
import { serializePayrollInputs } from "../payroll/payroll.input-lock.repository";
import { createEmploymentAssignmentService } from "../employment-assignment/employment-assignment.service";
import { employmentAssignmentRepository } from "../employment-assignment/employment-assignment.repository";
import { employeeRepository } from "./employee.repository";
import { createEmployeeService } from "./employee.service";

const databaseTest = process.env.TEST_DATABASE_URL ? test : test.skip;
const gate = () => { let open!: () => void; const promise = new Promise<void>(resolve => { open = resolve; }); return { promise, open }; };
const writer = { async insert(_executor: DatabaseExecutor, event: { action: string; requestId: string }) { return { id: 1, action: event.action, requestId: event.requestId }; } };

// Deliberate test-only service collaborators: real repositories, transactions and locks;
// payroll period policy and organization validation have their own focused suites.
async function setup() {
  const clients = [0, 1, 2].map(() => new Client({ connectionString: process.env.TEST_DATABASE_URL }));
  await Promise.all(clients.map(client => client.connect()));
  const [manager, transfer, control] = clients as [Client, Client, Client];
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const yesterday = new Date(new Date(`${today}T00:00:00Z`).valueOf() - 86400000).toISOString().slice(0, 10);
  const paths = (await control.query(`select distinct on (branch_id) branch_id::text,department_id::text,position_id::text from employment_assignments order by branch_id,id`)).rows;
  expect(paths.length).toBeGreaterThanOrEqual(2);
  const [first, second] = paths;
  const accountId = String((await control.query("select id from user_accounts order by id limit 1")).rows[0].id);
  const code = `RACE-${crypto.randomUUID().slice(0, 20)}`;
  const employeeId = String((await control.query(`insert into employees(employee_code,passport_id,first_name,last_name,hire_date) values($1,$1,'Race','Scope',$2) returning id`, [code, yesterday])).rows[0].id);
  await control.query(`insert into employment_assignments(employee_id,branch_id,department_id,position_id,base_salary,effective_from) values($1,$2,$3,$4,'15000.00',$5)`, [employeeId, first.branch_id, first.department_id, first.position_id, yesterday]);
  const managerActor: AuthenticatedActor = { accountId, employeeId: null, username: "race-manager", grants: [{ grantId: "1", roleCode: "BRANCH_MANAGER", scope: "branch", branchId: first.branch_id, departmentId: null }] };
  const ownerActor: AuthenticatedActor = { accountId, employeeId: null, username: "race-owner", grants: [{ grantId: "2", roleCode: "OWNER", scope: "all", branchId: null, departmentId: null }] };
  const executor = (client: Client) => drizzle(client) as unknown as DatabaseExecutor;
  const runner = (client: Client): TransactionRunner => ({ async transaction(work) { await client.query("begin"); try { const value = await work(executor(client) as never); await client.query("commit"); return value; } catch (error) { await client.query("rollback"); throw error; } } });
  const assignment = (client: Client, beforeWrite?: () => Promise<void>) => createEmploymentAssignmentService({ rootExecutor: executor(client), transactionRunner: runner(client), repository: employmentAssignmentRepository, organization: { async validateActiveAssignmentPath() { await beforeWrite?.(); } }, payroll: { serialize: serializePayrollInputs, assertInputsMutable: serializePayrollInputs }, actions: new ActionObserver(executor(client), writer), domain: new DomainAuditObserver(writer) });
  const makeEmployee = (afterRead?: () => Promise<void>) => createEmployeeService({ rootExecutor: executor(manager), transactionRunner: runner(manager), payroll: { serialize: serializePayrollInputs }, repository: employeeRepository, writeRepository: { ...employeeRepository, async findById(...args) { const row = await employeeRepository.findById(...args); await afterRead?.(); return row; } }, employmentTermination: assignment(manager), actions: new ActionObserver(executor(manager), writer), domain: new DomainAuditObserver(writer), today: () => today });
  const move = (beforeWrite?: () => Promise<void>) => assignment(transfer, beforeWrite).createAssignment({ actor: ownerActor, requestId: code + "-move", employeeId, branchId: second.branch_id, departmentId: second.department_id, positionId: second.position_id, employmentType: "full_time", baseSalary: "16000.00", welfareAmount: "0.00", effectiveFrom: today, effectiveTo: null });
  const waitForLock = async (client: Client) => {
    const pid = (await control.query("select pid from pg_stat_activity where pid=$1", [(client as unknown as { processID: number }).processID])).rows[0].pid;
    for (let attempt = 0; attempt < 200; attempt++) {
      if ((await control.query("select 1 from pg_locks where pid=$1 and locktype='advisory' and not granted", [pid])).rowCount) return;
      await Bun.sleep(10);
    }
    throw new Error("Expected operation to wait on the shared advisory lock");
  };
  return { manager, transfer, control, employeeId, today, managerActor, executor, makeEmployee, move, waitForLock, assignment, runner, async close() { await Promise.all(clients.map(async client => { await client.query("rollback").catch(() => {}); await client.end(); })); } };
}

for (const operation of ["profile", "status"] as const) {
  databaseTest(`transfer before ${operation} authorization denies the former manager`, async () => {
    const fixture = await setup(); const locked = gate(); const resume = gate(); const pending: Promise<unknown>[] = [];
    try {
      const moving = fixture.move(async () => { locked.open(); await resume.promise; });
      pending.push(moving);
      await locked.promise;
      const service = fixture.makeEmployee();
      const command = { actor: fixture.managerActor, requestId: "race", employeeId: fixture.employeeId };
      const mutation = operation === "profile" ? service.updateEmployee({ ...command, phone: "must-not-write" }) : service.changeEmployeeStatus({ ...command, status: "inactive", terminatedAt: null, reason: "race" });
      // Attach rejection handler immediately, then establish that scope reading is blocked.
      const outcome = mutation.then(value => ({ value, error: null }), error => ({ value: null, error }));
      pending.push(outcome);
      await fixture.waitForLock(fixture.manager);
      resume.open(); await moving;
      const result = await outcome;
      expect(result.error?.code).toBe("FORBIDDEN_SCOPE");
      const row = (await fixture.control.query("select phone,status from employees where id=$1", [fixture.employeeId])).rows[0];
      expect(row).toEqual({ phone: null, status: "active" });
    } finally { resume.open(); await Promise.allSettled(pending); await fixture.close(); }
  });

  databaseTest(`transfer after ${operation} scope read waits until the authorized write commits`, async () => {
    const fixture = await setup(); const read = gate(); const resume = gate(); const pending: Promise<unknown>[] = [];
    try {
      const service = fixture.makeEmployee(async () => { read.open(); await resume.promise; });
      const command = { actor: fixture.managerActor, requestId: "race", employeeId: fixture.employeeId };
      const mutation = operation === "profile" ? service.updateEmployee({ ...command, phone: "authorized" }) : service.changeEmployeeStatus({ ...command, status: "inactive", terminatedAt: null, reason: "race" });
      pending.push(mutation);
      await read.promise;
      const move = fixture.move().then(value => ({ value, error: null }), error => ({ value: null, error }));
      pending.push(move);
      await fixture.waitForLock(fixture.transfer);
      resume.open(); await mutation;
      const moved = await move;
      expect(moved.error?.code ?? null).toBe(operation === "status" ? "RESOURCE_NOT_FOUND" : null);
      const row = (await fixture.control.query("select phone,status from employees where id=$1", [fixture.employeeId])).rows[0];
      expect(row).toEqual({ phone: operation === "profile" ? "authorized" : null, status: operation === "status" ? "inactive" : "active" });
    } finally { resume.open(); await Promise.allSettled(pending); await fixture.close(); }
  });
}

 databaseTest("direct termination takes the advisory lock before assignment row locks while a transfer races", async () => {
  const fixture = await setup(); const locked = gate(); const resume = gate(); const pending: Promise<unknown>[] = [];
  try {
   const moving = fixture.move(async () => { locked.open(); await resume.promise; });
   pending.push(moving);
   await locked.promise;
   const ending = fixture.runner(fixture.manager).transaction(executor => fixture.assignment(fixture.manager).endAssignmentsForTermination(executor,{actor:fixture.managerActor,requestId:"race-end",employeeId:fixture.employeeId,date:fixture.today,reason:"race"})).then(value=>({value,error:null}),error=>({value:null,error}));
   pending.push(ending);
   await fixture.waitForLock(fixture.manager);
   await fixture.control.query("begin");
   await fixture.control.query("select id from employment_assignments where employee_id=$1 for update nowait",[fixture.employeeId]);
   await fixture.control.query("rollback");
   resume.open(); await moving;
   expect((await ending).error?.code).toBe("FORBIDDEN_SCOPE");
  } finally {resume.open();await Promise.allSettled(pending);await fixture.close();}
 });
