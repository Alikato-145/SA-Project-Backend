import { expect, test } from "bun:test";
import { Client } from "pg";
const databaseTest=process.env.TEST_DATABASE_URL?test:test.skip;
databaseTest("loan request real transactions preserve scope, one-loan decisions, rollback and locked schedule range",async()=>{
 if(process.env.DATABASE_URL!==process.env.TEST_DATABASE_URL)throw new Error("Use matching disposable DATABASE_URL and TEST_DATABASE_URL");
 const client=new Client({connectionString:process.env.TEST_DATABASE_URL});await client.connect();
 const key=crypto.randomUUID().slice(0,8);
 const one=async(sql:string,args:unknown[]=[])=>Number((await client.query(sql,args)).rows[0].id);
 try {
  const shop=await one("insert into shops(code,name) values($1,'Loan request test') returning id",[`LR-${key}`]);
  const branch=await one("insert into branches(shop_id,code,name) values($1,'A','A') returning id",[shop]);
  const department=await one("insert into departments(branch_id,code,name) values($1,'A','A') returning id",[branch]);
  const position=await one("insert into positions(shop_id,code,name) values($1,'A','A') returning id",[shop]);
  const employee=await one("insert into employees(employee_code,passport_id,first_name,last_name,hire_date) values($1,$1,'Loan','Test','2026-01-01') returning id",[`LR-${key}`]);
  const account=await one("insert into user_accounts(username,password_hash,employee_id) values($1,'fixture',$2) returning id",[`lr-${key}`,employee]);
  await client.query("insert into employment_assignments(employee_id,branch_id,department_id,position_id,base_salary,effective_from) values($1,$2,$3,$4,30000,'2026-01-01')",[employee,branch,department,position]);
  const { createEmployeeOperationContextService }=await import("../employee/employee.operation-context.service");
  const { createPayrollInputService }=await import("../payroll/payroll.service");
  const { DrizzlePayrollInputRepository,DrizzlePayrollInputProvider }=await import("../payroll/payroll.repository");
  const { createLoanRuntimeService }=await import("./loan.runtime.service");
  const { createLoanRequestRuntimeService }=await import("./loan-request.runtime.service");
  const { DrizzleLoanRepository }=await import("./loan.repository");
  const { LoanService }=await import("./loan.service");
  const runtime={context:createEmployeeOperationContextService(),payroll:createPayrollInputService(new DrizzlePayrollInputRepository(),new DrizzlePayrollInputProvider()),domain:{async record(){}}} as any;
  const service=createLoanRequestRuntimeService(runtime,createLoanRuntimeService(runtime));
  const actor=(roleCode:"EMPLOYEE"|"HR"|"OWNER"|"BRANCH_MANAGER")=>({accountId:account,trustedActor:{accountId:String(account),employeeId:roleCode==="EMPLOYEE"?String(employee):null,username:"fixture",grants:[{grantId:"1",roleCode,scope:roleCode==="EMPLOYEE"?"self":roleCode==="BRANCH_MANAGER"?"branch":"all",branchId:roleCode==="BRANCH_MANAGER"?String(branch):null,departmentId:null}]}} as any);
  const command={employeeId:employee,principalAmount:"100.01",installmentCount:3,reason:`Loan ${key}`};
  const request=await service.createRequest(actor("EMPLOYEE"),command);
  await expect(service.createRequest(actor("EMPLOYEE"),{...command,employeeId:employee+1})).rejects.toMatchObject({code:"FORBIDDEN_SCOPE"});
  await expect(service.listRequests(actor("EMPLOYEE"),employee+1)).rejects.toMatchObject({code:"FORBIDDEN_SCOPE"});
  for(const role of ["EMPLOYEE","BRANCH_MANAGER"] as const)await expect(service.approveRequest(actor(role),request.id,"2099-01-01")).rejects.toMatchObject({code:"FORBIDDEN_SCOPE"});
  const results=await Promise.allSettled([service.approveRequest(actor("HR"),request.id,"2099-01-01"),service.approveRequest(actor("OWNER"),request.id,"2099-01-01")]);
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(results.find(r=>r.status==="rejected")).toMatchObject({reason:{code:"LOAN_REQUEST_NOT_PENDING"}});
  const approved=(await client.query("select loan_id,status from loan_requests where id=$1",[request.id])).rows[0];expect(approved.status).toBe("approved");
  expect((await client.query("select count(*)::int n,sum(amount)::text total from loan_installments where loan_id=$1",[approved.loan_id])).rows[0]).toEqual({n:3,total:"100.01"});
  expect((await client.query("select count(*)::int n from loans where employee_id=$1",[employee])).rows[0].n).toBe(1);
  const rejected=await service.createRequest(actor("EMPLOYEE"),command);await service.rejectRequest(actor("OWNER"),rejected.id,"Not eligible");
  expect((await client.query("select status,decision_note,loan_id from loan_requests where id=$1",[rejected.id])).rows[0]).toEqual({status:"rejected",decision_note:"Not eligible",loan_id:null});
  const rollback=await service.createRequest(actor("EMPLOYEE"),command);
  await expect(service.approveRequest(actor("HR"),rollback.id,"2000-01-01")).rejects.toMatchObject({code:"LOAN_REQUEST_PAST_DUE_MONTH"});
  const brokenRepository=new DrizzleLoanRepository();const create=brokenRepository.create.bind(brokenRepository);
  brokenRepository.create=(command,schedule)=>create(command,[...schedule,schedule[0]!]);
  const brokenLoans=new LoanService(brokenRepository,{async assertCanCreate(){},async assertCanRead(){}},{async assertPayrollLocked(){}});
  await expect(createLoanRequestRuntimeService(runtime,brokenLoans).approveRequest(actor("HR"),rollback.id,"2099-01-01")).rejects.toMatchObject({cause:{code:"23505"}});
  expect((await client.query("select status,loan_id,decided_at from loan_requests where id=$1",[rollback.id])).rows[0]).toEqual({status:"pending",loan_id:null,decided_at:null});
  expect((await client.query("select count(*)::int n from loans where employee_id=$1",[employee])).rows[0].n).toBe(1);
  await client.query("insert into payroll_periods(shop_id,period_year,period_month,start_date,end_date,status,created_by_user_account_id) values($1,2099,12,'2099-12-01','2099-12-31','locked',$2)",[shop,account]);
  await expect(service.approveRequest(actor("HR"),rollback.id,"2099-10-01")).rejects.toMatchObject({code:"PAYROLL_PERIOD_LOCKED"});
  expect((await client.query("select status from loan_requests where id=$1",[rollback.id])).rows[0].status).toBe("pending");
  // A payroll lock committed while approval waits must win before schedule writes.
  await client.query("begin");await client.query("select pg_advisory_xact_lock(72419,5)");
  let settled=false;const racing=service.approveRequest(actor("HR"),rollback.id,"2098-01-01").then(value=>{settled=true;return {value};},error=>{settled=true;return {error};});
  await new Promise(resolve=>setTimeout(resolve,100));expect(settled).toBe(false);
  await client.query("insert into payroll_periods(shop_id,period_year,period_month,start_date,end_date,status,created_by_user_account_id) values($1,2098,3,'2098-03-01','2098-03-31','locked',$2)",[shop,account]);await client.query("commit");
  expect(await racing).toMatchObject({error:{code:"PAYROLL_PERIOD_LOCKED"}});
  expect((await client.query("select status from loan_requests where id=$1",[rollback.id])).rows[0].status).toBe("pending");

 } finally {await client.query("rollback").catch(()=>{});await client.end();}
},30000);
