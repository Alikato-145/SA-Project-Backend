import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { SignJWT } from "jose";

const testUrl = process.env.TEST_DATABASE_URL;
const databaseTest = testUrl && process.env.DATABASE_URL === testUrl ? test : test.skip;
type Row = Record<string, unknown>;
type Envelope = { data?: unknown; error?: { code: string; message: string }; request_id?: string };

// This fixture is intentionally retained only in TEST_DATABASE_URL. Append-only
// audit/approval facts must not be deleted for test cleanup. Every run is unique.
databaseTest("B5: authenticated two-branch operations reconcile through payroll lock", async () => {
  const client = new Client({ connectionString: testUrl });
  await client.connect();
  const key = randomUUID().slice(0, 8);
  const { hashPassword } = await import("../core/auth/password");
  const fixturePassword = "B5-Disposable-Only!";
  const passwordHash = await hashPassword(fixturePassword);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [year, month] = today.split("-").map(Number);
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const day = (n: number) => `${prefix}-${String(n).padStart(2, "0")}`;
  const lastDay = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  const one = async (query: string, values: unknown[] = []): Promise<string> => {
    const result = await client.query<{ id: string }>(query, values);
    return String(result.rows[0]!.id);
  };
  try {
    await client.query("BEGIN");
    const shop = await one("insert into shops(code,name) values($1,'B5 Test') returning id", [`B5-${key}`]);
    const otherShop = await one("insert into shops(code,name) values($1,'Other Shop') returning id", [`B5O-${key}`]);
    const branchA = await one("insert into branches(shop_id,code,name) values($1,'A','Branch A') returning id", [shop]);
    const branchB = await one("insert into branches(shop_id,code,name) values($1,'B','Branch B') returning id", [shop]);
    const branchOther = await one("insert into branches(shop_id,code,name) values($1,'O','Other') returning id", [otherShop]);
    const departmentA = await one("insert into departments(branch_id,code,name) values($1,'K','Kitchen') returning id", [branchA]);
    const departmentB = await one("insert into departments(branch_id,code,name) values($1,'K','Kitchen') returning id", [branchB]);
    const departmentOther = await one("insert into departments(branch_id,code,name) values($1,'K','Kitchen') returning id", [branchOther]);
    const position = await one("insert into positions(shop_id,code,name) values($1,'COOK','Cook') returning id", [shop]);
    const otherPosition = await one("insert into positions(shop_id,code,name) values($1,'COOK','Cook') returning id", [otherShop]);
    const employee = await one("insert into employees(employee_code,passport_id,first_name,last_name,hire_date) values($1,$1,'B5','Employee',$2) returning id", [`B5E-${key}`, day(1)]);
    const otherEmployee = await one("insert into employees(employee_code,passport_id,first_name,last_name,hire_date) values($1,$1,'Other','Employee',$2) returning id", [`B5EO-${key}`, day(1)]);
    const owner = await one("insert into user_accounts(username,password_hash) values($1,$2) returning id", [`b5-owner-${key}`, passwordHash]);
    const manager = await one("insert into user_accounts(username,password_hash) values($1,$2) returning id", [`b5-manager-${key}`, passwordHash]);
    const supervisor = await one("insert into user_accounts(username,password_hash) values($1,$2) returning id", [`b5-supervisor-${key}`, passwordHash]);
    const self = await one("insert into user_accounts(username,password_hash,employee_id) values($1,$2,$3) returning id", [`b5-self-${key}`, passwordHash, employee]);
    for (const [code, scope] of [["OWNER", "all"], ["BRANCH_MANAGER", "branch"], ["SUPERVISOR", "department"], ["EMPLOYEE", "self"]]) {
      await client.query("insert into roles(code,name,scope) values($1,$1,$2) on conflict(code) do nothing", [code, scope]);
    }
    await client.query("insert into user_account_roles(user_account_id,role_id,branch_id,department_id) select $1,id,$3,$4 from roles where code=$2", [owner, "OWNER", null, null]);
    await client.query("insert into user_account_roles(user_account_id,role_id,branch_id,department_id) select $1,id,$3,$4 from roles where code=$2", [manager, "BRANCH_MANAGER", branchA, null]);
    await client.query("insert into user_account_roles(user_account_id,role_id,branch_id,department_id) select $1,id,$3,$4 from roles where code=$2", [supervisor, "SUPERVISOR", branchA, departmentA]);
    await client.query("insert into user_account_roles(user_account_id,role_id,branch_id,department_id) select $1,id,$3,$4 from roles where code=$2", [self, "EMPLOYEE", null, null]);
    await client.query("insert into employment_assignments(employee_id,branch_id,department_id,position_id,base_salary,effective_from,effective_to) values($1,$2,$3,$4,'30000.00',$5,$6),($1,$7,$8,$4,'30000.00',$9,null)", [employee, branchA, departmentA, position, day(1), day(15), branchB, departmentB, day(16)]);
    await client.query("insert into employment_assignments(employee_id,branch_id,department_id,position_id,base_salary,effective_from) values($1,$2,$3,$4,'30000.00',$5)", [otherEmployee, branchOther, departmentOther, otherPosition, day(1)]);
    const leaveType = await one("insert into leave_types(code,name_th,quota_type,quota_days,is_deductible) values($1,'B5 Leave','fixed','10',true) returning id", [`B5L-${key}`]);
    await client.query("insert into leave_quotas(employee_id,leave_type_id,quota_year,entitled_days) values($1,$2,$3,'10')", [employee, leaveType, year]);
    const debtType = await one("insert into debt_types(code,name_th) values($1,'B5 Food') returning id", [`B5D-${key}`]);
    // Pending approvals and missing attendance in another shop must not block ours.
    await client.query("insert into leave_requests(employee_id,original_leave_type_id,start_date,end_date,requested_days,submitted_by_user_account_id) values($1,$2,$3,$3,'1',$4)", [otherEmployee, leaveType, day(1), owner]);
    await client.query("insert into overtime_records(employee_id,overtime_date,overtime_type,hours,requested_by_user_account_id) values($1,$2,'hourly','1',$3)", [otherEmployee, day(1), owner]);
    await client.query("insert into advance_requests(employee_id,request_month,amount,requested_by_user_account_id) values($1,$2,'1.00',$3)", [otherEmployee, day(1), owner]);
    await client.query("COMMIT");
    await Bun.write("/private/tmp/haris-b5-demo.json", JSON.stringify({ owner_username: `b5-owner-${key}`, manager_username: `b5-manager-${key}`, employee_username: `b5-self-${key}`, password: fixturePassword, owner_id: owner, manager_id: manager, employee_account_id: self, shop_id: shop, branch_a: branchA, branch_b: branchB, employee_id: employee, leave_type_id: leaveType, debt_type_id: debtType, start_date: day(1), end_date: day(lastDay) }, null, 2));

    const { createApp } = await import("../app");
    const app = createApp();
    const origin = (process.env.AUTH_ALLOWED_ORIGINS ?? "http://localhost:3000").split(",")[0]!;
    const token = async (account: string, expired = false) => new SignJWT({})
      .setProtectedHeader({ alg: "HS256" }).setSubject(account).setIssuedAt()
      .setExpirationTime(expired ? Math.floor(Date.now() / 1000) - 10 : "1h")
      .sign(new TextEncoder().encode(process.env.AUTH_JWT_SECRET!));
    const cookies = new Map<string, string>();
    for (const id of [owner, manager, supervisor, self]) cookies.set(id, `haris_session=${await token(id)}`);
    const request = async (path: string, body?: Row, account: string | null = owner, method = body ? "POST" : "GET") => {
      const response = await app.handle(new Request(`${origin}/api/v1${path}`, {
        method, headers: { origin, "content-type": "application/json", ...(account ? { cookie: cookies.get(account)! } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }));
      const text = await response.text();
      let envelope: Envelope;
      try { envelope = JSON.parse(text) as Envelope; } catch { throw new Error(`${path}: HTTP ${response.status}: ${text}`); }
      return { status: response.status, body: envelope };
    };
    const success = async (path: string, body?: Row, account = owner, method?: string): Promise<Row> => {
      const result = await request(path, body, account, method);
      expect(result.status, `${path}: ${JSON.stringify(result.body)}`).toBeLessThan(300);
      expect(result.body.request_id).toBeString();
      return result.body.data as Row;
    };
    expect((await request(`/work-day-records?employee_id=${employee}&start_date=${day(1)}&end_date=${day(lastDay)}`, undefined, null)).status).toBe(401);
    cookies.set("expired", `haris_session=${await token(owner, true)}`);
    expect((await request(`/leave-requests?employee_id=${employee}`, undefined, "expired")).status).toBe(401);
    expect((await request(`/leave-requests?employee_id=${otherEmployee}`, undefined, self)).status).toBe(403);
    expect((await request(`/branch-schedules?branch_id=${branchB}`, undefined, manager)).status).toBe(403);
    expect((await request(`/leave-requests?employee_id=9007199254740993`)).status).toBe(422);
    expect((await request(`/work-day-records?employee_id=${employee}&start_date=2026-02-30&end_date=2026-03-01`)).status).toBe(422);
    expect((await request("/work-day-records", { employee_id: employee, branch_id: branchA, work_date: day(1), status: "present", late_minutes: 0, is_deductible: false, actor: { scope: "all" } })).status).toBe(422);
    const wrongOrigin = await app.handle(new Request(`${origin}/api/v1/advance-requests`, { method: "POST", headers: { origin: "https://invalid.example", "content-type": "application/json", cookie: cookies.get(owner)! }, body: JSON.stringify({ employee_id: employee, amount: "1.00" }) }));
    expect(wrongOrigin.status).toBe(403);
    for (const branch of [branchA, branchB]) {
      await success("/branch-schedules", { branch_id: branch, work_start_time: "09:00:00", standard_close_time: "21:00:00", late_grace_minutes: 5, effective_from: day(1), effective_to: null });
    }
    await success(`/branch-schedules/${branchA}/overrides/${day(11)}`, { is_closed: true, work_start_time: null, close_time: null, reason: "Rest-day fixture" }, owner, "PUT");
    await success("/holiday-calendars", { shop_id: shop, holiday_date: day(12), name: "Test holiday", is_active: true });
    for (let n = 1; n <= lastDay; n++) {
      await success("/work-day-records", { employee_id: employee, branch_id: n <= 15 ? branchA : branchB, work_date: day(n), status: n >= 2 && n <= 4 ? "absent" : n === 11 ? "weekly_holiday" : n === 12 ? "public_holiday" : "present", late_minutes: 0, is_deductible: n >= 2 && n <= 4 });
    }
    const duplicate = await request("/work-day-records", { employee_id: employee, branch_id: branchA, work_date: day(1), status: "present", late_minutes: 0, is_deductible: false });
    expect(duplicate.status).toBe(409);
    const leave = await success("/leave-requests", { employee_id: employee, leave_type_id: leaveType, start_date: day(2), end_date: day(4) }, self);
    await success(`/leave-requests/${leave.id}/approve`, {}, supervisor);
    expect((await request(`/leave-requests/${leave.id}/approve`, {}, supervisor)).status).toBe(409);
    const fourDays = await success("/leave-requests", { employee_id: employee, leave_type_id: leaveType, start_date: day(5), end_date: day(8) }, self);
    const supervisorLimit = await request(`/leave-requests/${fourDays.id}/approve`, {}, supervisor);
    expect(supervisorLimit.status).toBe(403);
    expect((supervisorLimit.body as any).error.code).toBe("SUPERVISOR_APPROVAL_LIMIT");
    await success(`/leave-requests/${fourDays.id}/reject`, {}, owner);
    for (const [date, type, quantity] of [[day(10), "hourly", { hours: "2.00" }], [day(11), "rest_day", { day_units: "1.00" }], [day(12), "public_holiday", { day_units: "1.00" }]] as const) {
      const ot = await success("/overtime-records", { employee_id: employee, overtime_date: date, overtime_type: type, ...quantity }, self);
      await success(`/overtime-records/${ot.id}/approve`, {}, owner);
    }
    await success("/loans", { employee_id: employee, principal_amount: "200.00", installment_count: 2, first_due_month: day(1), reason: "B5 loan" });
    const debt = await success("/debt-transactions", { employee_id: employee, debt_type_id: debtType, transaction_kind: "charge", amount: "25.00", description: "B5 meal" });
    const reversed = await success("/debt-transactions", { employee_id: employee, debt_type_id: debtType, transaction_kind: "charge", amount: "99.00", description: "Mistaken meal" });
    await success(`/debt-transactions/${reversed.id}/reverse`, { description: "Correction" });
    for (const [config_key, numeric_value, unit] of [["STANDARD_WORK_DAYS", String(lastDay), "days"], ["ABSENCE_RATE", "1.0000", "multiplier"], ["LATE_RATE", "2.0000", "currency_per_minute"], ["SOCIAL_SECURITY_RATE", "0.0500", "ratio"], ["SOCIAL_SECURITY_CAP", "750.0000", "currency"], ["OT_HOURLY_RATE", "1.5000", "multiplier"], ["OT_REST_DAY_RATE", "1.0000", "multiplier"], ["OT_PUBLIC_HOLIDAY_RATE", "2.0000", "multiplier"]]) {
      await success("/payroll/configurations", { shop_id: shop, branch_id: null, config_key, numeric_value, unit, effective_from: day(1), effective_to: null });
    }
    const period = await success("/payroll/periods", { shop_id: shop, period_year: year, period_month: month, start_date: day(1), end_date: day(lastDay) });
    // The real approval journey runs on eligible dates; earlier dates retain a
    // separately verified ineligible outcome and do not fabricate eligibility.
    let advanceAmount = 0;
    if (Number(today.slice(-2)) >= 26) {
      const advance = await success("/advance-requests", { employee_id: employee, amount: "1000.00" }, self);
      expect((await request(`/payroll/periods/${period.id}/lock`, {})).status).toBe(409);
      await success(`/advance-requests/${advance.id}/approve`, {});
      advanceAmount = 1000;
    }
    const preview = await success(`/payroll/periods/${period.id}/preview`, {});
    expect(preview.blockers).toEqual([]);
    const records = preview.records as Row[];
    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(record.employee_id).toBe(employee);
    expect(record.total_deductions).toBe((750 + advanceAmount + 100 + 25).toFixed(2));
    expect((record.items as Row[]).filter(row => row.item_type === "absence" || row.item_type === "sick_unpaid" || row.item_type === "lateness")).toHaveLength(0);
    expect((record.items as Row[]).filter(row => row.item_type === "debt").map(row => row.source_id)).toEqual([debt.id]);
    expect((record.items as Row[]).filter(row => String(row.item_type).startsWith("overtime_"))).toHaveLength(3);
    const locked = await success(`/payroll/periods/${period.id}/lock`, {});
    expect((locked.period as Row).status).toBe("locked");
    expect((locked.records as Row[])[0]!.net_pay).toBe(record.net_pay);
    const attendance = (await success(`/work-day-records?employee_id=${employee}&start_date=${day(1)}&end_date=${day(lastDay)}`)) as unknown as Row[];
    expect(attendance.find(row => row.work_date === day(1))!.branch_id).toBe(branchA);
    expect(attendance.find(row => row.work_date === day(16))!.branch_id).toBe(branchB);
    const correction = await request(`/work-day-records/${attendance.find(row => row.work_date === day(1))!.id}`, { status: "absent", late_minutes: 0, is_deductible: true }, owner, "PATCH");
    expect(correction.status).toBe(409);
    expect((await request(`/debt-transactions/${debt.id}/reverse`, { description: "Too late" })).status).toBe(409);
    expect((await request(`/payroll/periods/${period.id}/lock`, {})).status).toBe(409);
    const ledger = await success(`/debt-transactions?employee_id=${employee}`);
    expect(ledger.outstanding_balance).toBe("0.00");
    expect((ledger.entries as Row[]).find(row => row.id === debt.id)!.settled_in_payroll_record_id).toBeString();
    const persistedRecord = await client.query("select id from payroll_records where payroll_period_id=$1 and employee_id=$2", [period.id, employee]);
    const settlement = await client.query("select count(*)::int as count from payroll_items where payroll_record_id=$1 and source_table='debt_transactions' and item_type='debt'", [persistedRecord.rows[0].id]);
    expect(settlement.rows[0].count).toBe(1);
    const used = await client.query("select used_days from leave_quotas where employee_id=$1 and leave_type_id=$2", [employee, leaveType]);
    expect(used.rows[0].used_days).toBe("3.00");
    const audit = await client.query("select count(*)::int as count from audit_logs where actor_user_account_id=any($1::bigint[]) and new_data is not null", [[owner, manager, supervisor, self]]);
    expect(audit.rows[0].count).toBeGreaterThan(30);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
}, 60_000);
