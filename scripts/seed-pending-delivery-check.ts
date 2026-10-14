import { pool, closeDatabase } from "../src/core/db/client";

try {
  if (process.env.NODE_ENV === "production" || process.env.RELEASE_DISPOSABLE_DB !== "1" || !process.env.TEST_DATABASE_URL || process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL) throw new Error("Pending-attempt fixture requires an explicitly disposable test database.");
  const source = await pool.query<{ payslip_id: string; record_id: string; shop_id: string; period_id: string }>(`
    select p.id::text as payslip_id, r.id::text as record_id, pp.shop_id::text, pp.id::text as period_id
    from payslips p join payroll_records r on r.id=p.payroll_record_id
    join payroll_periods pp on pp.id=r.payroll_period_id join employees e on e.id=r.employee_id
    where p.status='generated' and e.employee_code ~ '^E_[A-Z0-9]+$'
    and not exists(select 1 from email_delivery_logs d where d.payslip_id=p.id and d.status='pending')
    order by p.id desc limit 1`);
  if (!source.rows[0]) throw new Error("Run the synthetic fresh-organization browser journey first.");
  const fixture = source.rows[0];
  const pending = await pool.query<{ id: string }>(`insert into email_delivery_logs(payslip_id,recipient_email,status,attempted_at)
    values($1,'resolution@example.test','pending',now()-interval '15 minutes') returning id::text`, [fixture.payslip_id]);
  console.info(JSON.stringify({ ...fixture, attempt_id: pending.rows[0]!.id }));
} finally { await closeDatabase(); }
