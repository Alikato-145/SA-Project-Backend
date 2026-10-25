import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { createBankAccountCipher } from "../employee-bank-account/employee-bank-account.crypto";
export const reportTestCipher=()=>createBankAccountCipher({activeVersion:"v1",keys:{v1:new Uint8Array(32)}});
// Disposable synthetic payroll only; insert frozen facts before locking, never disable immutability.
export async function seedReportFixture(pool:Pool){
 const key=`RPT-${randomUUID().slice(0,8)}`;
 const one=async(sql:string,values:unknown[]=[])=>String((await pool.query(sql,values)).rows[0].id);
 const actorId=await one("select id from user_accounts where username='hr'");
 const shopId=await one("insert into shops(code,name) values($1,$1) returning id",[key]);
 const positionId=await one("insert into positions(shop_id,code,name) values($1,'RPT','Report') returning id",[shopId]);
 const periodId=await one("insert into payroll_periods(shop_id,period_year,period_month,start_date,end_date,created_by_user_account_id) values($1,2096,10,'2096-10-01','2096-10-31',$2) returning id",[shopId,actorId]);
 const branches:string[]=[],departments:string[]=[],employees:{id:string;recordId:string;code:string;bankId:string|null}[]=[];
 for(let i=0;i<2;i++){
 const branch=await one("insert into branches(shop_id,code,name) values($1,$2,$3) returning id",[shopId,`R${i}`,`สาขารายงาน ${i+1}`]);branches.push(branch);
 departments.push(await one("insert into departments(branch_id,code,name) values($1,'RPT','แผนกรายงาน') returning id",[branch]));}
 const cases=[{base:"12000",earn:"12000",ded:"600",member:true},{base:"4000",earn:"4000",ded:"200",member:false},{base:"0",earn:"9000",ded:"0",member:false},{base:null,earn:"8000",ded:"400",member:false},{base:"0",earn:"0",ded:"0",member:false}];
 for(const [i,c] of cases.entries()){
 const code=`${key}-${i}`,b=i<3?0:1;
 const id=await one("insert into employees(employee_code,passport_id,first_name,last_name,hire_date,payment_method,promptpay_phone) values($1,$1,$2,$3,'2096-01-01',$4,$5) returning id",[code,`พนักงานรายงาน ${i+1}`,i===0?'นามสกุลภาษาไทยยาวเพื่อทดสอบการตัดบรรทัดในเอกสาร':'ทดสอบ',i===2?'cash':'transfer',i===3?'0812345678':null]);
 const assignment=await one("insert into employment_assignments(employee_id,branch_id,department_id,position_id,base_salary,effective_from,is_social_security_member) values($1,$2,$3,$4,30000,'2096-01-01',$5) returning id",[id,branches[b],departments[b],positionId,c.member]);
 const bankId=i<2?await one("insert into employee_bank_accounts(employee_id,bank_code,bank_name,account_holder_name,account_number_ciphertext,account_number_last4) values($1,'004','Synthetic','Report test',$2,'1234') returning id",[id,await reportTestCipher().encrypt('0000001234')]):null;
 const recordId=await one("insert into payroll_records(payroll_period_id,employee_id,employment_assignment_id,is_social_security_member_snapshot,social_security_base_snapshot,base_salary_snapshot,total_earnings,total_deductions,net_pay) values($1,$2,$3,$4,$5,30000,$6,$7,$6::numeric-$7::numeric) returning id",[periodId,id,assignment,c.member,c.base,c.earn,c.ded]);
 await pool.query("insert into payroll_items(payroll_record_id,item_type,direction,description,amount) values($1,'base_salary','earning','Frozen wages',$2),($1,'social_security','deduction','Frozen SS',$3)",[recordId,c.earn,c.ded]);
 await pool.query("update payroll_records set status='locked',locked_at=now() where id=$1",[recordId]);employees.push({id,recordId,code,bankId});}
 await pool.query("update payroll_periods set status='locked',locked_at=now(),locked_by_user_account_id=$2 where id=$1",[periodId,actorId]);return{key,shopId,periodId,actorId,branches,departments,employees};
}
