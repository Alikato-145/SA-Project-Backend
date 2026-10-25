// Disposable-only orchestration; never imported by application composition.
import { mkdirSync, writeFileSync } from "node:fs";
import { Pool } from "pg";
import { seedPaymentFixture } from "../src/features/payroll/payroll-payment.test-support";
import { seedReportFixture } from "../src/features/reports/report.test-support";

const url = new URL(process.env.TEST_DATABASE_URL ?? "http://missing");
if (process.env.RELEASE_DISPOSABLE_DB !== "1" || !["postgres", "127.0.0.1", "localhost"].includes(url.hostname)
  || (url.hostname !== "postgres" && url.port !== "55440")) throw new Error("Explicit disposable verification database required");
const directory = process.env.UAT_FIXTURE_DIR;
if (!directory) throw new Error("UAT_FIXTURE_DIR is required");
const pool = new Pool({ connectionString: url.toString() });
try {
  mkdirSync(directory, { recursive: true });
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const lifecycle of [false, true]) {
      const fixture = await seedPaymentFixture(client, lifecycle);
      writeFileSync(`${directory}/${lifecycle ? "lifecycle" : "payments"}.json`, JSON.stringify(fixture, null, 2));
    }
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
  const scoped = (await pool.query(`select e.id as employee_id, ea.branch_id, ea.department_id, ea.position_id,
    (select id from user_accounts where username='branch_manager') as manager_account_id
    from employees e join employment_assignments ea on ea.employee_id=e.id
    where e.employee_code='RELEASE-2' and ea.effective_to is null`)).rows[0];
  if (!scoped) throw new Error("Release other-branch scope fixture is missing");
  writeFileSync(`${directory}/scope.json`, JSON.stringify(scoped, null, 2));
  // Report helper consumes a Pool; its unique fixture is never reset or reused.
  const reports = await seedReportFixture(pool);
  await pool.query("update employees set promptpay_phone='0812345678' where id=$1", [reports.employees[1]!.id]);
  writeFileSync(`${directory}/reports.json`, JSON.stringify(reports, null, 2));
  console.log(`Fresh payment, lifecycle and report fixtures: ${directory}`);
} finally { await pool.end(); }
