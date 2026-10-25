import {expect,test} from "bun:test";
import {Pool} from "pg";
import {drizzle} from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";
import {ActionObserver} from "../../core/audit/action-observer";
import {auditRepository} from "../audit/audit.repository";
import {payrollActor} from "../payroll/payroll.test-support";
import {createReportService} from "./report.service";
import {reportRepository} from "./report.repository";
import {createReportRoutes} from "./report.routes";
import {reportTestCipher,seedReportFixture} from "./report.test-support";
const dbTest=process.env.TEST_DATABASE_URL?test:test.skip;
const setup=async()=>{const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL}),db=drizzle(pool,{schema});const f=await seedReportFixture(pool),actor={...payrollActor(),accountId:f.actorId};return{pool,db,f,actor,service:createReportService({rootExecutor:db,actions:new ActionObserver(db,auditRepository),cipher:reportTestCipher()})};};
dbTest("locked payable uses historical rows and exact totals without payment destinations",async()=>{
 const{pool,f,actor,service}=await setup();try{
 const summary=await service.salaryPayable(actor,f.periodId,f.key);
 expect(summary.totals).toMatchObject({employeeCount:5,payableCount:4,earnings:"33000.00",deductions:"1200.00",net:"31800.00",paid:"0.00",outstanding:"31800.00"});expect(summary.branches[0]!.rows).toHaveLength(3);expect(summary.branches[1]!.totals.net).toBe("7600.00");
 await pool.query("update employment_assignments set effective_to='2096-10-31' where id=(select employment_assignment_id from payroll_records where id=$1)",[f.employees[0]!.recordId]);
 await pool.query("insert into employment_assignments(employee_id,branch_id,department_id,position_id,base_salary,effective_from,is_social_security_member) select employee_id,$2,$3,position_id,99999,'2096-11-01',false from employment_assignments where id=(select employment_assignment_id from payroll_records where id=$1)",[f.employees[0]!.recordId,f.branches[1],f.departments[1]]);
 expect(await service.salaryPayable(actor,f.periodId,f.key)).toEqual(summary);expect(JSON.stringify(summary)).not.toMatch(/ciphertext|accountNumber|0000001234/);
 expect((await service.salaryPayable(payrollActor("OWNER"),f.periodId,f.key,{departmentId:f.departments[1]})).totals.employeeCount).toBe(2);
 await expect(service.salaryPayable(actor,f.periodId,f.key,{branchId:f.branches[0],departmentId:f.departments[1]})).rejects.toMatchObject({code:"INVALID_ORGANIZATION_RELATION"});
 for(const role of["EMPLOYEE","SUPERVISOR","BRANCH_MANAGER"]as const){const denied={...actor,grants:[{...actor.grants[0]!,roleCode:role}]};for(const read of[service.salaryPayable,service.bankTransfer,service.socialSecurity])await expect(read(denied,"999999999",f.key)).rejects.toMatchObject({code:"FORBIDDEN_SCOPE"});}
 const draft=String((await pool.query("insert into payroll_periods(shop_id,period_year,period_month,start_date,end_date,created_by_user_account_id) values($1,2096,11,'2096-11-01','2096-11-30',$2) returning id",[f.shopId,f.actorId])).rows[0].id);await expect(service.salaryPayable(actor,draft,f.key)).rejects.toMatchObject({code:"STATE_CONFLICT"});expect(await service.summary(actor,draft,f.key)).toBeDefined();
 const routes=createReportRoutes({service,authenticate:async()=>actor});for(const kind of["salary","creditor"]){const r=await routes.handle(new Request(`http://test/api/v1/reports/${kind}-summary.pdf?period_id=${f.periodId}&branch_id=${f.branches[1]}`));expect(r.status).toBe(200);expect(r.headers.get("content-type")).toBe("application/pdf");expect(r.headers.get("cache-control")).toBe("private, no-store");expect(r.headers.get("x-content-type-options")).toBe("nosniff");expect(Buffer.from(await r.arrayBuffer()).subarray(0,5).toString()).toBe("%PDF-");}
 }finally{await pool.end();}
},30000);
dbTest("SS exports covered wages, former membership, explicit zero and NULL legacy independently of live salary",async()=>{
 const{pool,f,actor,service}=await setup();try{
 await pool.query("update employment_assignments set base_salary=99999 where employee_id=any($1::bigint[])",[f.employees.map(e=>e.id)]);
 const body=await service.socialSecurity(actor,f.periodId,f.key);expect(body).toContain('"12000.00","600.00"');expect(body).toContain('"4000.00","200.00"');expect(body).toContain('"8000.00","400.00"');expect(body).not.toContain(f.employees[2]!.code);expect(body).not.toContain('30000');expect(body).not.toContain('99999');
 const filtered=await service.socialSecurity(actor,f.periodId,f.key,{branchId:f.branches[1]});expect(filtered).not.toContain(f.employees[0]!.code);expect(filtered).toContain(f.employees[3]!.code);
 }finally{await pool.end();}
},30000);
dbTest("bank export freezes prepared bank and blocks partial outstanding export, excludes paid cash zero and cancelled",async()=>{
 const{pool,db,f,actor,service}=await setup();try{
 await expect(service.bankTransfer(actor,f.periodId,f.key)).rejects.toMatchObject({code:"VALIDATION_ERROR"});
 const prepare=async(i:number,method='transfer')=>String((await pool.query(`insert into payroll_payments(payroll_record_id,branch_id_snapshot,payment_method,amount,prepared_by_user_account_id,employee_bank_account_id,bank_code_snapshot,account_holder_name_snapshot,account_number_ciphertext_snapshot,account_number_last4_snapshot,promptpay_phone_snapshot) select p.id,a.branch_id,$2::payment_method,p.net_pay,$3,b.id,b.bank_code,b.account_holder_name,b.account_number_ciphertext,b.account_number_last4,case when not p.is_social_security_member_snapshot and $2='transfer' then '0812345678' else null end from payroll_records p join employment_assignments a on a.id=p.employment_assignment_id left join employee_bank_accounts b on b.employee_id=p.employee_id and $2='transfer' where p.id=$1 returning payroll_payments.id`,[f.employees[i]!.recordId,method,f.actorId])).rows[0].id);
 const old=await prepare(0);await pool.query("update payroll_payments set status='cancelled',cancelled_at=now(),cancelled_by_user_account_id=$2,cancellation_reason='correction' where id=$1",[old,f.actorId]);await pool.query("update employee_bank_accounts set bank_code='006',account_holder_name='Frozen replacement',account_number_ciphertext=$2,account_number_last4='2468' where id=$1",[f.employees[0]!.bankId,await reportTestCipher().encrypt('0000002468')]);await prepare(0);const paid=await prepare(1);await pool.query("update payroll_payments set status='paid',paid_at=now(),paid_by_user_account_id=$2 where id=$1",[paid,f.actorId]);await prepare(2,'cash');const phone=await prepare(3);
 await expect(service.bankTransfer(actor,f.periodId,f.key)).rejects.toMatchObject({code:"VALIDATION_ERROR",message:expect.stringContaining("QR")});
 await pool.query("update employee_bank_accounts set account_number_ciphertext=$2,account_number_last4='9999' where id=$1",[f.employees[0]!.bankId,await reportTestCipher().encrypt('0000009999')]);
 const body=await service.bankTransfer(actor,f.periodId,f.key,{branchId:f.branches[0]});expect(body.split('\r\n').filter(Boolean)).toHaveLength(2);expect(body).toContain('"006","0000002468","Frozen replacement"');expect(body).not.toContain('1234');expect(body).not.toContain('9999');expect(body).toContain('"11400.00"');
 const summary=await service.salaryPayable(actor,f.periodId,f.key);expect(summary.totals).toMatchObject({employeeCount:5,paid:"3800.00",outstanding:"28000.00"});expect(summary.branches[0]!.rows).toHaveLength(3);expect(await reportRepository.lockedRows(db,f.periodId,{branchId:f.branches[0]})).toHaveLength(3);
 await pool.query("update payroll_payments set status='cancelled',cancelled_at=now(),cancelled_by_user_account_id=$2,cancellation_reason='use bank' where id=$1",[phone,f.actorId]);await pool.query("insert into employee_bank_accounts(employee_id,bank_code,bank_name,account_holder_name,account_number_ciphertext,account_number_last4) values($1,'004','Synthetic','Report phone',$2,'5678')",[f.employees[3]!.id,await reportTestCipher().encrypt('0000005678')]);await prepare(3);expect((await service.bankTransfer(actor,f.periodId,f.key)).split('\r\n').filter(Boolean)).toHaveLength(3);
 }finally{await pool.end();}
},30000);
