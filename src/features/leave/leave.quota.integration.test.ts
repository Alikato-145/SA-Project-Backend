import { afterAll, beforeAll, expect, test } from "bun:test";
import { Client } from "pg";
import { SignJWT } from "jose";

const url = process.env.TEST_DATABASE_URL;
const enabled = Boolean(url && url === process.env.DATABASE_URL && process.env.RELEASE_DISPOSABLE_DB === "1");
const dbTest = enabled ? test : test.skip;
const client = new Client({ connectionString: url });
const origin = (process.env.AUTH_ALLOWED_ORIGINS ?? "http://localhost:3000").split(",")[0]!;
let app: { handle(request: Request): Promise<Response> };
let employee: string, self: string, owner: string;
const cookies = new Map<string, string>();
const one = async (sql: string, args: unknown[] = []) => String((await client.query(sql, args)).rows[0].id);
async function request(path: string, data?: object, account = self, method = data ? "POST" : "GET") {
  const response = await app.handle(new Request(`${origin}/api/v1${path}`, { method, headers: { origin, "content-type": "application/json", cookie: cookies.get(account)! }, ...(data ? { body: JSON.stringify(data) } : {}) }));
  return { status: response.status, body: await response.json() as any };
}
async function type(options: { entitled?: string; used?: string; frozen?: boolean; allowExceed?: boolean; none?: boolean } = {}) {
  const id = await one("insert into leave_types(code,name_th,quota_type,is_deductible,allow_exceed) values($1,'UC08 fixture',$2,false,$3) returning id", [`Q${crypto.randomUUID().slice(0, 16)}`, options.none ? "none" : "fixed", options.allowExceed ?? false]);
  if (options.entitled !== undefined) await client.query("insert into leave_quotas(employee_id,leave_type_id,quota_year,entitled_days,used_days,frozen_at) values($1,$2,2036,$3,$4,$5)", [employee,id,options.entitled,options.used ?? "0",options.frozen ? new Date() : null]);
  return id;
}
const command = (id: string, start = "2036-02-01", end = start) => ({ employee_id: employee, leave_type_id: id, start_date: start, end_date: end, reason: "UC08 synthetic test" });
async function snapshot(id: string) {
  const requests = (await client.query("select * from leave_requests where employee_id=$1 and original_leave_type_id=$2 order by id", [employee,id])).rows;
  const days = (await client.query("select d.* from leave_request_days d join leave_requests r on r.id=d.leave_request_id where r.employee_id=$1 and r.original_leave_type_id=$2 order by d.id", [employee,id])).rows;
  const actions = (await client.query("select a.* from leave_approval_actions a join leave_requests r on r.id=a.leave_request_id where r.employee_id=$1 and r.original_leave_type_id=$2 order by a.id", [employee,id])).rows;
  return { requests, days, actions };
}
beforeAll(async () => {
  if (!enabled) return;
  await client.connect();
  const key = `UC08-${crypto.randomUUID().slice(0, 8)}`;
  const shop = await one("insert into shops(code,name) values($1,$1) returning id", [key]);
  const branch = await one("insert into branches(shop_id,code,name) values($1,'Q','Quota') returning id", [shop]);
  const department = await one("insert into departments(branch_id,code,name) values($1,'Q','Quota') returning id", [branch]);
  const position = await one("insert into positions(shop_id,code,name) values($1,'Q','Quota') returning id", [shop]);
  employee = await one("insert into employees(employee_code,passport_id,first_name,last_name,hire_date) values($1,$1,'Quota','UC08','2020-01-01') returning id", [key]);
  await client.query("insert into employment_assignments(employee_id,branch_id,department_id,position_id,base_salary,effective_from) values($1,$2,$3,$4,'30000','2020-01-01')", [employee,branch,department,position]);
  await client.query("insert into branch_schedules(branch_id,work_start_time,standard_close_time,late_grace_minutes,effective_from) values($1,'09:00','18:00',0,'2020-01-01')", [branch]);
  const { hashPassword } = await import("../../core/auth/password");
  const hash = await hashPassword("Disposable-UC08-Only!");
  for (const role of ["EMPLOYEE", "OWNER"]) {
    const account = await one("insert into user_accounts(username,password_hash,employee_id) values($1,$2,$3) returning id", [`${key}-${role}`,hash,role === "EMPLOYEE" ? employee : null]);
    if (role === "EMPLOYEE") self = account; else owner = account;
    await client.query("insert into user_account_roles(user_account_id,role_id) select $1,id from roles where code=$2", [account,role]);
    const token = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(account).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(process.env.AUTH_JWT_SECRET!));
    cookies.set(account,`haris_session=${token}`);
  }
  const { createApp } = await import("../../app"); app = createApp();
});
afterAll(async () => { if (enabled) await client.end(); });

for (const [label, options, code] of [
  ["missing", {}, "LEAVE_QUOTA_EXCEEDED"],
  ["exhausted", { entitled: "1", used: "1" }, "LEAVE_QUOTA_EXCEEDED"],
  ["fractional insufficient", { entitled: "1.29", used: "0.30" }, "LEAVE_QUOTA_EXCEEDED"],
  ["frozen", { entitled: "3", frozen: true }, "LEAVE_QUOTA_FROZEN"],
  ["excess missing", { allowExceed: true }, "LEAVE_QUOTA_EXCEEDED"],
  ["excess frozen", { entitled: "0", frozen: true, allowExceed: true }, "LEAVE_QUOTA_FROZEN"],
] as const) dbTest(`UC08 ${label} submit rejects without persisted request/day/action`, async () => {
  const id = await type(options);
  const result = await request("/leave-requests", command(id));
  expect(result.status).toBe(code === "LEAVE_QUOTA_FROZEN" ? 409 : 422);
  expect(result.body.error.code).toBe(code);
  expect(await snapshot(id)).toEqual({ requests: [], days: [], actions: [] });
});

dbTest("UC08 cross-year precheck rejects missing or insufficient second year and pending edit keeps all old facts", async () => {
  const id = await type({ entitled: "1" });
  const data = command(id,"2036-12-31","2037-01-01");
  expect((await request("/leave-requests",data)).body.error.code).toBe("LEAVE_QUOTA_EXCEEDED");
  expect(await snapshot(id)).toEqual({ requests: [], days: [], actions: [] });
  await client.query("insert into leave_quotas(employee_id,leave_type_id,quota_year,entitled_days,used_days) values($1,$2,2037,'0.99','0')",[employee,id]);
  expect((await request("/leave-requests",data)).status).toBe(422);
  const valid = await request("/leave-requests",command(id,"2036-12-30"));
  expect(valid.status,JSON.stringify(valid.body)).toBe(200);
  const before = await snapshot(id);
  const edit = await request(`/leave-requests/${valid.body.data.id}`,data,self,"PATCH");
  expect(edit.body.error.code).toBe("LEAVE_QUOTA_EXCEEDED");
  expect(await snapshot(id)).toEqual(before);
  await client.query("update leave_quotas set entitled_days='1' where employee_id=$1 and leave_type_id=$2 and quota_year=2037",[employee,id]);
  const accepted = await request(`/leave-requests/${valid.body.data.id}`,data,self,"PATCH");
  expect(accepted.status,JSON.stringify(accepted.body)).toBe(200);
  const quotas = (await client.query("select used_days from leave_quotas where employee_id=$1 and leave_type_id=$2 order by quota_year",[employee,id])).rows;
  expect(quotas).toEqual([{used_days:"0.00"},{used_days:"0.00"}]);
});

dbTest("UC08 pending type edits reject missing/frozen/exhausted quota and preserve request/days/history", async () => {
  const id = await type({ none: true });
  const valid = await request("/leave-requests",command(id,"2036-03-01"));
  expect(valid.status).toBe(200);
  const before = await snapshot(id);
  for (const options of [{}, {entitled:"1",used:"1"}, {entitled:"1",frozen:true}]) {
    const target = await type(options);
    const rejected = await request(`/leave-requests/${valid.body.data.id}`,command(target,"2036-03-01"),self,"PATCH");
    expect(rejected.status).toBe("frozen" in options ? 409 : 422);
    expect(rejected.body.error.code).toBe("frozen" in options ? "LEAVE_QUOTA_FROZEN" : "LEAVE_QUOTA_EXCEEDED");
    expect(await snapshot(id)).toEqual(before);
    expect(await snapshot(target)).toEqual({requests:[],days:[],actions:[]});
  }
});

dbTest("UC08 explicit excess submits without consumption and approval marks only excess unpaid", async () => {
  const id = await type({entitled:"1",allowExceed:true});
  const submitted = await request("/leave-requests",command(id,"2036-04-01","2036-04-02"));
  expect(submitted.status).toBe(200);
  expect((await client.query("select used_days from leave_quotas where employee_id=$1 and leave_type_id=$2",[employee,id])).rows[0].used_days).toBe("0.00");
  const approved = await request(`/leave-requests/${submitted.body.data.id}/approve`,{},owner);
  expect(approved.status,JSON.stringify(approved.body)).toBe(200);
  const days = (await snapshot(id)).days;
  expect(days.map(d=>({paid:d.is_paid,deductible:d.is_deductible,quota:d.quota_consumed}))).toEqual([{paid:true,deductible:false,quota:"1.00"},{paid:false,deductible:true,quota:"0.00"}]);
});

dbTest("UC08 concurrent nonoverlap submissions reserve nothing; approvals serialize and recheck remaining quota", async () => {
  const id = await type({entitled:"1.30",used:"0.30"});
  const submissions = await Promise.all([request("/leave-requests",command(id,"2036-05-01")),request("/leave-requests",command(id,"2036-05-02"))]);
  expect(submissions.map(r=>r.status)).toEqual([200,200]);
  expect((await client.query("select used_days from leave_quotas where employee_id=$1 and leave_type_id=$2",[employee,id])).rows[0].used_days).toBe("0.30");
  const approvals = await Promise.all(submissions.map(r=>request(`/leave-requests/${r.body.data.id}/approve`,{},owner)));
  expect(approvals.map(r=>r.status).sort()).toEqual([200,422]);
  expect(approvals.find(r=>r.status===422)!.body.error.code).toBe("LEAVE_QUOTA_EXCEEDED");
  const persisted = await snapshot(id);
  expect(persisted.requests.map(r=>r.status).sort()).toEqual(["approved","pending"]);
  expect(persisted.actions.filter(a=>a.action==="approved")).toHaveLength(1);
  expect((await client.query("select used_days from leave_quotas where employee_id=$1 and leave_type_id=$2",[employee,id])).rows[0].used_days).toBe("1.30");
});
