import { afterAll, describe, expect, test } from "bun:test";
import { Client } from "pg";

const configPath = new URL("../config/env.config.ts", import.meta.url).pathname;

const runConfig = async (databaseUrl: string) => {
  const child = Bun.spawn({
    cmd: [Bun.which("bun")!, configPath],
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  return { exitCode: await child.exited, output: `${stdout}${stderr}` };
};

describe("database URL safety", () => {
  test.each(["postgresql://postgres@localhost/haris_payroll", "postgres://postgres@localhost/haris_payroll"])(
    "accepts %s without opening a database connection",
    async (databaseUrl) => {
      const result = await runConfig(databaseUrl);

      expect(result.exitCode).toBe(0);
    },
  );

  test("rejects a MySQL URL without exposing credentials", async () => {
    const password = "not-for-output";
    const result = await runConfig(`mysql://legacy:${password}@localhost/haris_payroll`);

    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain("PostgreSQL");
    expect(result.output).not.toContain(password);
    expect(result.output).not.toContain("mysql://legacy");
  });

  test("rejects malformed and non-PostgreSQL URLs without echoing input", async () => {
    const password = "not-for-output";
    const result = await runConfig(`not-a-database-url-${password}`);

    expect(result.exitCode).not.toBe(0);
    expect(result.output).not.toContain(password);
    expect(result.output).not.toContain("not-a-database-url");
  });
});

const databaseUrl = process.env.DATABASE_INTEGRATION === "1"
  ? process.env.DATABASE_URL
  : undefined;
const client = databaseUrl ? new Client({ connectionString: databaseUrl }) : undefined;

const catalogTest = databaseUrl ? test : test.skip;

catalogTest("PostgreSQL catalog contains the canonical baseline", async () => {
  await client!.connect();

  const [{ table_count }] = (
    await client!.query<{ table_count: string }>(
      "select count(*) as table_count from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'",
    )
  ).rows;
  const [{ enum_count }] = (
    await client!.query<{ enum_count: string }>(
      "select count(*) as enum_count from pg_type type join pg_namespace namespace on namespace.oid = type.typnamespace where namespace.nspname = 'public' and type.typtype = 'e'",
    )
  ).rows;
  const [{ migration_count }] = (
    await client!.query<{ migration_count: string }>(
      'select count(*) as migration_count from drizzle."__drizzle_migrations"',
    )
  ).rows;

  expect(Number(table_count)).toBe(36);
  expect(Number(enum_count)).toBe(22);
  expect(Number(migration_count)).toBe(1);
});

catalogTest("all domain primary keys use bigint", async () => {
  const { rows } = await client!.query<{ table_name: string; data_type: string }>(
    `select columns.table_name, columns.data_type
     from information_schema.table_constraints constraints
     join information_schema.key_column_usage keys
       on keys.constraint_name = constraints.constraint_name
      and keys.table_schema = constraints.table_schema
     join information_schema.columns columns
       on columns.table_name = keys.table_name
      and columns.column_name = keys.column_name
      and columns.table_schema = keys.table_schema
     where constraints.constraint_type = 'PRIMARY KEY'
       and constraints.table_schema = 'public'`,
  );

  expect(rows).toHaveLength(36);
  expect(rows.every(({ data_type }) => data_type === "bigint")).toBe(true);
});

catalogTest("installs PostgreSQL history protections", async () => {
  const { rows: constraints } = await client!.query<{ conname: string }>(
    `select conname from pg_constraint
     where connamespace = 'public'::regnamespace
       and conname in (
         'employment_assignments_no_overlap',
         'employee_weekly_holidays_no_overlap',
         'branch_schedules_no_overlap',
         'payroll_configurations_no_overlap',
         'approved_leave_requests_no_overlap'
       )`,
  );
  const { rows: triggers } = await client!.query<{ tgname: string }>(
    `select tgname from pg_trigger
     where not tgisinternal
       and tgname in (
         'audit_logs_append_only',
         'leave_approval_actions_append_only',
         'overtime_approval_actions_append_only',
         'debt_transactions_append_only',
         'payroll_records_locked_immutable',
         'payroll_items_locked_immutable'
       )`,
  );

  expect(constraints.map(({ conname }) => conname).sort()).toEqual([
    'approved_leave_requests_no_overlap',
    'branch_schedules_no_overlap',
    'employee_weekly_holidays_no_overlap',
    'employment_assignments_no_overlap',
    'payroll_configurations_no_overlap',
  ]);
  expect(triggers.map(({ tgname }) => tgname).sort()).toEqual([
    'audit_logs_append_only',
    'debt_transactions_append_only',
    'leave_approval_actions_append_only',
    'overtime_approval_actions_append_only',
    'payroll_items_locked_immutable',
    'payroll_records_locked_immutable',
  ]);
});

afterAll(async () => {
  await client?.end();
});
