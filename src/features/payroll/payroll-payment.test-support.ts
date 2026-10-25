import { randomUUID } from "node:crypto";
import type { Client, Pool } from "pg";
// Disposable database fixtures only; never imported by application composition.
export const seedPaymentFixture = async (client: Pick<Client | Pool, "query">) => {
  const key = `PAY-${randomUUID().slice(0, 8)}`;
  const one = async (sql: string, values: unknown[] = []) => String((await client.query(sql, values)).rows[0].id);
  const actorId = await one("select id from user_accounts where username='hr'");
  const shopId = await one("insert into shops(code,name) values($1,$1) returning id", [key]);
  const positionId = await one("insert into positions(shop_id,code,name) values($1,'PAY','Payment') returning id", [shopId]);
  const periodId = await one("insert into payroll_periods(shop_id,period_year,period_month,start_date,end_date,status,created_by_user_account_id,locked_by_user_account_id,locked_at) values($1,2095,10,'2095-10-01','2095-10-31','locked',$2,$2,now()) returning id", [shopId, actorId]);
  const branches: string[] = [];
  const employees: {
    id: string;
    recordId: string;
    code: string;
    branchId: string;
    kind: string;
    amount: string;
  }[] = [];
  for (let branch = 0; branch < 2; branch++) {
    const branchId = await one("insert into branches(shop_id,code,name) values($1,$2,$2) returning id", [shopId, `Payment ${branch + 1}`]);
    branches.push(branchId);
    const departmentId = await one("insert into departments(branch_id,code,name) values($1,'PAY','Payment') returning id", [branchId]);
    for (const [i, kind] of ["member", "cash", "transfer", "zero"].entries()) {
      const code = `${key}-${branch}-${i}`;
      const id = await one("insert into employees(employee_code,passport_id,first_name,last_name,hire_date,payment_method,promptpay_phone,phone) values($1,$1,'Payment',$2,'2095-01-01',$3,$4,'0899999999') returning id", [code, kind, kind === "cash" ? "cash" : "transfer", kind === "transfer" ? "0812345678" : null]);
      const assignment = await one("insert into employment_assignments(employee_id,branch_id,department_id,position_id,base_salary,effective_from,is_social_security_member) values($1,$2,$3,$4,30000,'2095-01-01',$5) returning id", [id, branchId, departmentId, positionId, kind === "member"]);
      if (kind === "member")
        await client.query("insert into employee_bank_accounts(employee_id,bank_code,bank_name,account_holder_name,account_number_ciphertext,account_number_last4) values($1,'004','Test bank','Payment member','verification-only-opaque-envelope','1234')", [id]);
      const amount = kind === "zero" ? "0.00" : kind === "transfer" ? (branch === 0 ? "123.45" : "9999999999.99") : "100.01";
      const recordId = await one("insert into payroll_records(payroll_period_id,employee_id,employment_assignment_id,status,is_social_security_member_snapshot,social_security_base_snapshot,base_salary_snapshot,total_earnings,total_deductions,net_pay,locked_at) values($1,$2,$3,'locked',$4,0,30000,$5,0,$5,now()) returning id", [periodId, id, assignment, kind === "member", amount]);
      employees.push({ id, recordId, code, branchId, kind, amount });
    }
  }
  return { key, shopId, periodId, actorId, branches, employees };
};
