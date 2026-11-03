import { Client } from "pg";

if (process.env.RELEASE_DISPOSABLE_DB !== "1" || !process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
  throw new Error("Database checks require RELEASE_DISPOSABLE_DB=1 and matching disposable DATABASE_URL/TEST_DATABASE_URL.");
}
const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
await client.connect();
const { rows } = await client.query(`select e.id employee_id, a.id account_id, ea.branch_id,
  (select min(id) from leave_types) type_id from employees e
  join user_accounts a on a.employee_id=e.id
  join employment_assignments ea on ea.employee_id=e.id
  where a.username='employee' limit 1`);
await client.end();
const fixture = rows[0];
if (!fixture) throw new Error("Run the release fixture before database checks.");
const env = { ...process.env, A2_DATABASE_INTEGRATION: "1", DATABASE_INTEGRATION: "1",
  B1_TEST_EMPLOYEE_ID: String(fixture.employee_id), B1_TEST_BRANCH_ID: String(fixture.branch_id),
  B2_TEST_EMPLOYEE_ID: String(fixture.employee_id), B2_TEST_ACCOUNT_ID: String(fixture.account_id),
  B2_TEST_LEAVE_TYPE_ID: String(fixture.type_id) };
const totals = { pass: 0, skip: 0, fail: 0, failed_files: [] as string[] };
const conditionallySkipped: string[] = [];
const dateDependentTests = new Set([
  "UC12 reason and rejection note persist for own and finance reads; invalid decisions roll back unchanged facts",
  "UC12 exact 1000-character reason/note accepted and duplicate submissions preserve original reason",
  "UC12 approval retains 19/20 worked-day and half-base exact-cent guards",
  "UC12 projected net exactly zero approves and negative one cent rejects without decision/audit",
]);
const bangkokDay = Number(new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bangkok", day: "2-digit" }).format(new Date()));
const files = Array.from(new Bun.Glob("src/**/*.test.ts").scanSync()).sort();
for (const file of files) {
  const child = Bun.spawn([process.execPath, "test", file], { env, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  const log = out + err;
  const plainLog = log.replace(/\x1b\[[0-9;]*m/g, "");
  for (const key of ["pass", "skip", "fail"] as const) totals[key] += Number(plainLog.match(new RegExp("(\\d+) " + key + "\\b"))?.[1] ?? 0);
  if (code !== 0) { totals.failed_files.push(file); process.stderr.write(log); }
  if (file === "src/features/advance/advance.integration.test.ts" && bangkokDay < 20) {
    const skipped = Array.from(plainLog.matchAll(/^(?:\(skip\)|»)\s+(.+)$/gm), (match) => match[1]!);
    if (skipped.length === dateDependentTests.size && skipped.every((name) => dateDependentTests.has(name))) {
      conditionallySkipped.push(...skipped);
    }
  }
}
console.log(JSON.stringify({ ...totals, conditionally_skipped_before_day_20: conditionallySkipped, files: files.length }, null, 2));
process.exitCode = totals.failed_files.length || totals.skip !== conditionallySkipped.length ? 1 : 0;
