import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const url = process.env.TEST_DATABASE_URL;
const databaseTest = url && process.env.DATABASE_URL === url ? test : test.skip;

databaseTest("A5: owner logs in and reads an employee's dated history across branches", async () => {
  const client = new Client({ connectionString: url });
  await client.connect();
  const suffix = randomUUID().slice(0, 8);
  const password = "A5-Disposable-Only!";
  const { hashPassword } = await import("../core/auth/password");
  const one = async (sql: string, values: unknown[]): Promise<string> =>
    String((await client.query<{ id: string }>(sql, values)).rows[0]!.id);
  try {
    const shop = await one("insert into shops(code,name) values($1,'A5 Integration') returning id", [`A5-${suffix}`]);
    const branchA = await one("insert into branches(shop_id,code,name) values($1,'A','A') returning id", [shop]);
    const branchB = await one("insert into branches(shop_id,code,name) values($1,'B','B') returning id", [shop]);
    const departmentA = await one("insert into departments(branch_id,code,name) values($1,'K','Kitchen') returning id", [branchA]);
    const departmentB = await one("insert into departments(branch_id,code,name) values($1,'K','Kitchen') returning id", [branchB]);
    const position = await one("insert into positions(shop_id,code,name) values($1,'COOK','Cook') returning id", [shop]);
    const employee = await one("insert into employees(employee_code,passport_id,first_name,last_name,hire_date) values($1,$1,'A5','Employee','2026-01-01') returning id", [`A5E-${suffix}`]);
    await client.query("insert into employment_assignments(employee_id,branch_id,department_id,position_id,base_salary,effective_from,effective_to) values($1,$2,$3,$4,'20000.00','2026-01-01','2026-09-14')", [employee, branchA, departmentA, position]);
    await client.query("insert into employment_assignments(employee_id,branch_id,department_id,position_id,base_salary,effective_from) values($1,$2,$3,$4,'25000.00','2026-09-15')", [employee, branchB, departmentB, position]);
    const owner = await one("insert into user_accounts(username,password_hash) values($1,$2) returning id", [`a5-owner-${suffix}`, await hashPassword(password)]);
    await client.query("insert into roles(code,name,scope) values('OWNER','OWNER','all') on conflict(code) do nothing");
    await client.query("insert into user_account_roles(user_account_id,role_id) select $1,id from roles where code='OWNER'", [owner]);

    const { createApp } = await import("../app");
    const app = createApp();
    const origin = "http://localhost:3000";
    const call = async (path: string, cookie?: string, body?: object) => {
      const response = await app.handle(new Request(`${origin}/api/v1${path}`, {
        method: body ? "POST" : "GET",
        headers: { origin, ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }));
      return { status: response.status, cookie: response.headers.get("set-cookie"), body: await response.json() as { data?: any; error?: { code: string } } };
    };
    expect((await call(`/employees/${employee}`)).status).toBe(401);
    const login = await call("/auth/login", undefined, { username: `a5-owner-${suffix}`, password });
    expect(login.status).toBe(200);
    const cookie = login.cookie?.split(";")[0];
    expect(cookie).toStartWith("haris_session=");
    const me = await call("/auth/me", cookie);
    expect(me.status).toBe(200);
    const list = await call("/employees", cookie);
    expect(list.status).toBe(200);
    const detail = await call(`/employees/${employee}`, cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.data.id).toBe(employee);
    const history = await call(`/employees/${employee}/assignments`, cookie);
    expect(history.status).toBe(200);
    const serialized = JSON.stringify([login.body, me.body, list.body, detail.body, history.body]);
    expect(serialized).not.toContain(password);
    expect(serialized).not.toContain("password_hash");
    expect(serialized).toContain("20000.00");
    expect(serialized).toContain("25000.00");
    expect(serialized).toContain(branchA);
    expect(serialized).toContain(branchB);
  } finally {
    await client.end();
  }
}, 30_000);
