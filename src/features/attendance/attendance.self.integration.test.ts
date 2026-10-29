import { beforeAll, afterAll, expect, test } from "bun:test";
import { Client } from "pg";
import { SignJWT } from "jose";

const url = process.env.TEST_DATABASE_URL;
const enabled = Boolean(url && url === process.env.DATABASE_URL);
const dbTest = enabled ? test : test.skip;
const client = new Client({ connectionString: url });
let app: { handle(request: Request): Promise<Response> };
let employee: string, other: string, branch: string, transferred: string, self: string, owner: string, unlinked: string, noGrant: string;
const records: Record<string, string> = {};
const cookies = new Map<string, string>();
const origin = (process.env.AUTH_ALLOWED_ORIGINS ?? "http://localhost:3000").split(",")[0]!;
const day = (n: number) => `2034-02-${String(n).padStart(2, "0")}`;
const body = (n = 1) => ({ employee_id: employee, branch_id: branch, work_date: day(n), status: "present", clock_in_at: `${day(n)}T02:00:00Z`, clock_out_at: `${day(n)}T11:00:00Z`, late_minutes: 0, is_deductible: false });
async function request(path: string, data?: object, account = self, method = data ? "POST" : "GET") {
  const response = await app.handle(new Request(`${origin}/api/v1${path}`, { method, headers: { origin, "content-type": "application/json", cookie: cookies.get(account)! }, ...(data ? { body: JSON.stringify(data) } : {}) }));
  return { status: response.status, body: await response.json() as any };
}
async function ok(path: string, data?: object, account = self, method?: string) {
  const response = await request(path, data, account, method);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body.data;
}
beforeAll(async () => {
  if (!enabled) return;
  await client.connect();
  const one = async (sql: string, values: unknown[] = []) => String((await client.query(sql, values)).rows[0].id);
  const key = `UC07-${crypto.randomUUID().slice(0, 8)}`;
  const shop = await one("insert into shops(code,name) values($1,$1) returning id", [key]);
  branch = await one("insert into branches(shop_id,code,name) values($1,'A','Historical A') returning id", [shop]);
  transferred = await one("insert into branches(shop_id,code,name) values($1,'B','Current B') returning id", [shop]);
  const depA = await one("insert into departments(branch_id,code,name) values($1,'A','A') returning id", [branch]);
  const depB = await one("insert into departments(branch_id,code,name) values($1,'B','B') returning id", [transferred]);
  const position = await one("insert into positions(shop_id,code,name) values($1,'P','P') returning id", [shop]);
  employee = await one("insert into employees(employee_code,passport_id,first_name,last_name,hire_date) values($1,$1,'Self','UC07',$2) returning id", [key, day(1)]);
  other = await one("insert into employees(employee_code,passport_id,first_name,last_name,hire_date) values($1,$1,'Other','UC07',$2) returning id", [`${key}-other`, day(1)]);
  await client.query("insert into employment_assignments(employee_id,branch_id,department_id,position_id,base_salary,effective_from,effective_to) values($1,$2,$3,$4,'30000',$5,$6),($1,$7,$8,$4,'30000',$9,null),($10,$2,$3,$4,'30000',$5,null)", [employee, branch, depA, position, day(1), day(14), transferred, depB, day(15), other]);
  const { hashPassword } = await import("../../core/auth/password");
  const hash = await hashPassword("Disposable-UC07-Only!");
  for (const name of ["self", "owner", "unlinked", "noGrant"]) {
    const id = await one("insert into user_accounts(username,password_hash,employee_id) values($1,$2,$3) returning id", [`${key}-${name}`, hash, name === "self" ? employee : name === "noGrant" ? other : null]);
    if (name === "self") self = id; if (name === "owner") owner = id; if (name === "unlinked") unlinked = id; if (name === "noGrant") noGrant = id;
    if (name !== "noGrant") await client.query("insert into user_account_roles(user_account_id,role_id) select $1,id from roles where code=$2", [id, name === "owner" ? "OWNER" : "EMPLOYEE"]);
    const token = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(id).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(process.env.AUTH_JWT_SECRET!));
    cookies.set(id, `haris_session=${token}`);
  }
  for (const b of [branch, transferred]) await client.query("insert into branch_schedules(branch_id,work_start_time,standard_close_time,late_grace_minutes,effective_from) values($1,'09:00','18:00',5,$2)", [b, day(1)]);
  await client.query("insert into employee_weekly_holidays(employee_id,weekday,effective_from) values($1,0,$2)", [employee, day(1)]);
  await client.query("insert into holiday_calendars(shop_id,holiday_date,name) values($1,$2,'Public fixture')", [shop, day(3)]);
  await client.query("insert into branch_schedule_overrides(branch_id,schedule_date,is_closed,reason) values($1,$2,true,'Closed fixture')", [branch, day(4)]);
  for (const [name, n, source, status, person] of [["manual",6,"manual","present",employee],["import",7,"import","present",employee],["leave",8,"manual","leave",employee],["holiday",9,"manual","weekly_holiday",employee],["other",10,"manual","present",other],["locked",27,"manual","present",employee]] as const) {
    records[name] = await one("insert into work_day_records(employee_id,branch_id,work_date,status,late_minutes,is_deductible,entry_source) values($1,$2,$3,$4,0,false,$5) returning id", [person,n >= 15 ? transferred : branch,day(n),status,source]);
  }
  await client.query("insert into payroll_periods(shop_id,period_year,period_month,start_date,end_date,status,created_by_user_account_id,locked_at,locked_by_user_account_id) values($1,2034,2,$2,$3,'locked',$4,now(),$4)", [shop,day(27),day(28),owner]);
  const { createApp } = await import("../../app"); app = createApp();
});
afterAll(async () => { if (enabled) await client.end(); });

dbTest("blank ordinary attendance uses the effective schedule and marks its origin", async () => {
  await client.query("insert into branch_schedule_overrides(branch_id,schedule_date,is_closed,work_start_time,close_time) values($1,$2,false,'10:00','19:00')", [transferred, day(16)]);
  const blank = { ...body(2), clock_in_at: null, clock_out_at: null };
  const ordinary = await ok("/work-day-records", blank);
  expect(ordinary.clock_in_at).toBe(`${day(2)}T02:00:00.000Z`);
  expect(ordinary.clock_out_at).toBe(`${day(2)}T11:00:00.000Z`);
  expect(ordinary.note).toContain("เวลาตามตาราง");
  const override = await ok("/work-day-records", { ...body(16), branch_id: transferred, clock_in_at: null, clock_out_at: null });
  expect(override.clock_in_at).toBe(`${day(16)}T03:00:00.000Z`);
  expect(override.clock_out_at).toBe(`${day(16)}T12:00:00.000Z`);
  expect((await request("/work-day-records", { ...body(17), branch_id: transferred, clock_in_at: null })).status).toBe(422);
});

dbTest("UC07 own manual create persists historical branch and audit actor; duplicate remains rejected", async () => {
  const created = await ok("/work-day-records", body());
  expect(created).toMatchObject({ employee_id: employee, branch_id: branch, entry_source: "manual", late_minutes: 0 });
  expect((await request("/work-day-records", body())).status).toBe(409);
  const afterTransfer = await ok("/work-day-records", { ...body(15), branch_id: transferred });
  expect(afterTransfer.branch_id).toBe(transferred);
  const persisted = (await client.query("select branch_id::text,entry_source,created_by_user_account_id::text from work_day_records where id=$1", [created.id])).rows[0];
  expect(persisted).toEqual({ branch_id: branch, entry_source: "manual", created_by_user_account_id: self });
  const audit = (await client.query("select actor_user_account_id::text,new_data from audit_logs where table_name='work_day_records' and record_id=$1 order by id desc limit 1", [created.id])).rows[0];
  expect(audit.actor_user_account_id).toBe(self);
  expect(audit.new_data.branchId).toBe(Number(branch));
});

dbTest("UC07 self correction requires meaningful new reason and preserves provenance with old/new audit", async () => {
  for (const note of [undefined, "", "   ", "ok", "....."]) expect((await request(`/work-day-records/${records.manual}`, { status: "absent", is_deductible: true, note }, self, "PATCH")).status).toBe(422);
  const corrected = await ok(`/work-day-records/${records.manual}`, { status: "late", clock_in_at: `${day(6)}T02:15:00Z`, late_minutes: 10, is_deductible: true, note: "แก้เวลาเข้าตามที่ทำงานจริง" }, self, "PATCH");
  expect(corrected).toMatchObject({ branch_id: branch, entry_source: "manual", status: "late", late_minutes: 10 });
  const audit = (await client.query("select actor_user_account_id::text,old_data,new_data from audit_logs where table_name='work_day_records' and record_id=$1 order by id desc limit 1", [records.manual])).rows[0];
  expect(audit.actor_user_account_id).toBe(self); expect(audit.old_data.status).toBe("present");
  expect(audit.new_data.note).toBe("แก้เวลาเข้าตามที่ทำงานจริง");
  const listed = await ok(`/work-day-records?employee_id=${employee}&start_date=${day(1)}&end_date=${day(28)}`);
  expect(listed.find((r: any) => r.id === records.manual)).toMatchObject({ status: "late", late_minutes: 10 });
});

dbTest("UC07 rejects others, missing self grant/link, wrong historical branch, forged status/source and schedule bypass", async () => {
  expect((await request("/work-day-records", { ...body(11), employee_id: other })).status).toBe(403);
  for (const account of [unlinked, noGrant]) expect((await request("/work-day-records", body(11), account)).status).toBe(403);
  expect((await request("/work-day-records", { ...body(11), branch_id: transferred })).status).toBe(422);
  for (const status of ["leave", "weekly_holiday", "public_holiday"]) expect((await request("/work-day-records", { ...body(11), status })).status).toBe(422);
  expect((await request("/work-day-records", { ...body(11), entry_source: "biometric" })).status).toBe(422);
  for (const n of [3,4,5]) expect((await request("/work-day-records", body(n))).status).toBe(422);
  for (const fields of [{ clock_in_at: null }, { clock_in_at: `${day(11)}T02:15:00Z` }, { is_deductible: true }, { status: "absent", is_deductible: true }]) expect((await request("/work-day-records", { ...body(11), ...fields })).status).toBe(422);
  for (const suffix of ["", "/context", "/calendar"]) {
    const query = suffix === "/context" ? `employee_id=${other}&work_date=${day(1)}` : `employee_id=${other}&start_date=${day(1)}&end_date=${day(2)}`;
    expect((await request(`/work-day-records${suffix}?${query}`)).status).toBe(403);
  }
  expect((await request(`/work-day-records/${records.other}`, { note: "Cannot correct other person" }, self, "PATCH")).status).toBe(403);
  expect((await client.query("select count(*)::int n from work_day_records where employee_id=$1 and work_date=$2", [employee,day(11)])).rows[0].n).toBe(0);
});

dbTest("UC07 self cannot correct leave/import/holiday or locked inputs; staff manual workflow survives", async () => {
  for (const name of ["import", "leave", "holiday"]) expect((await request(`/work-day-records/${records[name]}`, { status: "absent", is_deductible: true, note: "Cannot replace protected facts" }, self, "PATCH")).status).toBe(422);
  expect((await request(`/work-day-records/${records.locked}`, { note: "Cannot change locked period" }, self, "PATCH")).status).toBe(409);
  expect((await request("/work-day-records", { ...body(28), branch_id: transferred })).status).toBe(409);
  for (const status of ["leave", "weekly_holiday", "public_holiday"]) expect((await request(`/work-day-records/${records.manual}`, { status, note: "Cannot forge approved leave or holiday" }, self, "PATCH")).status).toBe(422);
  const protectedRows = (await client.query("select status,entry_source,note from work_day_records where id=any($1::bigint[]) order by id", [[records.import, records.leave, records.holiday, records.locked]])).rows;
  expect(protectedRows).toEqual([{ status: "present", entry_source: "import", note: null }, { status: "leave", entry_source: "manual", note: null }, { status: "weekly_holiday", entry_source: "manual", note: null }, { status: "present", entry_source: "manual", note: null }]);
  await ok("/work-day-records", { ...body(12), status: "weekly_holiday", clock_in_at: null, clock_out_at: null }, owner);
  await ok(`/work-day-records/${records.import}`, { note: "Staff correction retained" }, owner, "PATCH");
});

dbTest("UC07 self authority rejects inactive or malformed grants without relaxing shared manage", async () => {
  const { concreteOperationsOptions } = await import("../../app");
  const service = concreteOperationsOptions().attendance;
  const { createEmployeeOperationContextService } = await import("../employee/employee.operation-context.service");
  const actor = { accountId: Number(self), trustedActor: { accountId: self, employeeId: employee, username: "disposable-self", grants: [{ grantId: "1", roleCode: "EMPLOYEE" as const, scope: "self" as const, branchId: null, departmentId: null }] } };
  await expect(createEmployeeOperationContextService().assertEmployee(actor, Number(employee), day(13), "manage")).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
  for (const grant of [{ ...actor.trustedActor.grants[0], roleActive: false }, { ...actor.trustedActor.grants[0], branchId: branch }, { ...actor.trustedActor.grants[0], scope: "all" }]) {
    await expect(service.createManualWorkDay({ ...actor, trustedActor: { ...actor.trustedActor, grants: [grant] } } as any, { employeeId: Number(employee), branchId: Number(branch), workDate: day(13), status: "absent", lateMinutes: 0, isDeductible: true })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
  }
  const absent = await ok("/work-day-records", { ...body(13), status: "absent", clock_in_at: null, clock_out_at: null, is_deductible: true });
  expect(absent).toMatchObject({ employee_id: employee, status: "absent", clock_in_at: null, is_deductible: true, entry_source: "manual" });
});
