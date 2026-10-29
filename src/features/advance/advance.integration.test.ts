import { afterAll, beforeAll, expect, test } from "bun:test";
import { Client } from "pg";
import { SignJWT } from "jose";

const url=process.env.TEST_DATABASE_URL;
const enabled=Boolean(url && url===process.env.DATABASE_URL && process.env.RELEASE_DISPOSABLE_DB==="1");
const dbTest=enabled?test:test.skip;
const db=new Client({connectionString:url});
const today=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const [year,month,day]=today.split("-").map(Number),start=`${today.slice(0,7)}-01`,end=new Date(Date.UTC(year!,month!,0)).toISOString().slice(0,10);
const origin=(process.env.AUTH_ALLOWED_ORIGINS??"http://localhost:3000").split(",")[0]!;
let app:{handle(request:Request):Promise<Response>},owner:string,shop:string,branch:string,department:string,position:string,period:string,debtType:string,passwordHash:string;
const cookies=new Map<string,string>();
const one=async(sql:string,args:unknown[]=[])=>String((await db.query(sql,args)).rows[0].id);
async function session(account:string){const token=await new SignJWT({}).setProtectedHeader({alg:"HS256"}).setSubject(account).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(process.env.AUTH_JWT_SECRET!));cookies.set(account,`haris_session=${token}`);}
async function request(path:string,data?:object,account=owner){const response=await app.handle(new Request(`${origin}/api/v1${path}`,{method:data?"POST":"GET",headers:{origin,"content-type":"application/json",cookie:cookies.get(account)!},...(data?{body:JSON.stringify(data)}:{})}));return {status:response.status,body:await response.json() as any};}
async function fixture(workedDays=day!,allDays=false){
 const key=`UC12-${crypto.randomUUID().slice(0,12)}`;
 const employee=await one("insert into employees(employee_code,passport_id,first_name,last_name,hire_date) values($1,$1,'Advance','UC12',$2) returning id",[key,start]);
 await db.query("insert into employment_assignments(employee_id,branch_id,department_id,position_id,base_salary,effective_from) values($1,$2,$3,$4,'30000',$5)",[employee,branch,department,position,start]);
 const account=await one("insert into user_accounts(username,password_hash,employee_id) values($1,$2,$3) returning id",[key,passwordHash,employee]);
 await db.query("insert into user_account_roles(user_account_id,role_id) select $1,id from roles where code='EMPLOYEE'",[account]);await session(account);
 const count=allDays?Number(end.slice(-2)):workedDays;
 for(let n=1;n<=count;n++){const date=`${today.slice(0,7)}-${String(n).padStart(2,"0")}`;await db.query("insert into work_day_records(employee_id,branch_id,work_date,status,clock_in_at,clock_out_at,is_deductible) values($1,$2,$3,'present',$4,$5,false)",[employee,branch,date,`${date}T02:00:00Z`,`${date}T11:00:00Z`]);}
 return {employee,account,key};
}
const submit=(f:{employee:string;account:string},reason:unknown="Emergency household expenses",amount="100.01")=>request("/advance-requests",{employee_id:f.employee,amount,...(reason===undefined?{}:{reason})},f.account);
async function snapshot(employee:string){return {requests:(await db.query("select * from advance_requests where employee_id=$1 order by id",[employee])).rows,audit:(await db.query("select * from audit_logs where table_name='advance_requests' and new_data->>'employeeId'=$1 order by id",[employee])).rows};}
beforeAll(async()=>{
 if(!enabled)return;if(day!<20)throw new Error("UC12 positive actual-date integration requires day >=20; no clock bypass");
 await db.connect();const key=`UC12-${crypto.randomUUID().slice(0,10)}`;
 shop=await one("insert into shops(code,name) values($1,'UC12 disposable') returning id",[key]);branch=await one("insert into branches(shop_id,code,name) values($1,'A','Advance') returning id",[shop]);department=await one("insert into departments(branch_id,code,name) values($1,'A','Advance') returning id",[branch]);position=await one("insert into positions(shop_id,code,name) values($1,'A','Advance') returning id",[shop]);
 await db.query("insert into branch_schedules(branch_id,work_start_time,standard_close_time,late_grace_minutes,effective_from) values($1,'09:00','18:00',0,$2)",[branch,start]);
 const {hashPassword}=await import("../../core/auth/password");passwordHash=await hashPassword("Disposable-UC12-Only!");owner=await one("insert into user_accounts(username,password_hash) values($1,$2) returning id",[key,passwordHash]);await db.query("insert into user_account_roles(user_account_id,role_id) select $1,id from roles where code='OWNER'",[owner]);await session(owner);
 for(const [key,value,unit]of [["STANDARD_WORK_DAYS","30","days"],["ABSENCE_RATE","1","multiplier"],["LATE_RATE","0","currency_per_minute"],["SOCIAL_SECURITY_RATE","0","ratio"],["SOCIAL_SECURITY_CAP","750","currency"]])await db.query("insert into payroll_configurations(shop_id,config_key,numeric_value,unit,effective_from,created_by_user_account_id) values($1,$2,$3,$4,$5,$6)",[shop,key,value,unit,start,owner]);
 period=await one("insert into payroll_periods(shop_id,period_year,period_month,start_date,end_date,created_by_user_account_id) values($1,$2,$3,$4,$5,$6) returning id",[shop,year,month,start,end,owner]);debtType=await one("insert into debt_types(code,name_th) values($1,'UC12 fixture') returning id",[key]);
 const {createApp}=await import("../../app");app=createApp();
});
afterAll(async()=>{if(enabled)await db.end();});

dbTest("UC12 invalid API reasons leave no request or successful audit",async()=>{
 const f=await fixture();for(const reason of [undefined,null,""," \n\t ","x".repeat(1001)]){const result=await request("/advance-requests",{employee_id:f.employee,amount:"100.01",...(reason===undefined?{}:{reason})},f.account);expect(result.status,JSON.stringify(result.body)).toBe(422);expect(result.body.error.code).toBe("VALIDATION_ERROR");expect(await snapshot(f.employee)).toEqual({requests:[],audit:[]});}
});
dbTest("UC12 reason and rejection note persist for own and finance reads; invalid decisions roll back unchanged facts",async()=>{
 const f=await fixture();const result=await submit(f,"  Emergency household expenses  ");expect(result.status,JSON.stringify(result.body)).toBe(200);const id=result.body.data.id;expect(result.body.data.reason).toBe("Emergency household expenses");
 const before=await snapshot(f.employee);for(const note of [undefined,null,""," \n\t ","x".repeat(1001)]){const denied=await request(`/advance-requests/${id}/reject`,note===undefined?{}:{note});expect(denied.status).toBe(422);expect(denied.body.error.code).toBe("VALIDATION_ERROR");expect(await snapshot(f.employee)).toEqual(before);}
 expect((await request(`/advance-requests/${id}/reject`,{note:"Employee cannot decide"},f.account)).status).toBe(403);expect(await snapshot(f.employee)).toEqual(before);
 const rejected=await request(`/advance-requests/${id}/reject`,{note:"  Repayment capacity insufficient  "});expect(rejected.status,JSON.stringify(rejected.body)).toBe(200);
 for(const actor of [f.account,owner])expect((await request(`/advance-requests?employee_id=${f.employee}`,undefined,actor)).body.data).toMatchObject([{id,reason:"Emergency household expenses",decision_note:"Repayment capacity insufficient",status:"rejected"}]);
 const saved=await snapshot(f.employee);expect(saved.requests[0]).toMatchObject({reason:"Emergency household expenses",decision_note:"Repayment capacity insufficient",status:"rejected",decided_by_user_account_id:owner});expect(saved.audit).toHaveLength(2);expect(saved.audit.map(r=>r.action)).toEqual(["advance.record.submit.succeeded","advance.record.reject.succeeded"]);
 expect((await request(`/advance-requests/${id}/approve`,{})).status).toBe(409);expect(await snapshot(f.employee)).toEqual(saved);
});
dbTest("UC12 exact 1000-character reason/note accepted and duplicate submissions preserve original reason",async()=>{
 const f=await fixture();const reason="r".repeat(1000);const responses=await Promise.all([submit(f,reason),submit(f,"Different concurrent reason")]);expect(responses.map(r=>r.status).sort()).toEqual([200,409]);const saved=await snapshot(f.employee);expect(saved.requests).toHaveLength(1);expect(saved.audit).toHaveLength(1);const id=String(saved.requests[0].id),original=saved.requests[0].reason;
 const duplicate=await submit(f,"Never overwrite prior reason");expect(duplicate.body.error.code).toBe("ADVANCE_ALREADY_EXISTS");expect(await snapshot(f.employee)).toEqual(saved);
 const note="n".repeat(1000);expect((await request(`/advance-requests/${id}/reject`,{note})).status).toBe(200);expect((await snapshot(f.employee)).requests[0]).toMatchObject({reason:original,decision_note:note});
 // Independently prove the exact maximum reason is persisted, regardless of the race winner.
 const max=await fixture();expect((await submit(max,reason)).status).toBe(200);expect((await snapshot(max.employee)).requests[0].reason).toBe(reason);
});
dbTest("UC12 legacy NULL reason stays honest in own/finance API and survives rejection without fabricated history",async()=>{
 const f=await fixture();const id=await one("insert into advance_requests(employee_id,request_month,amount,requested_by_user_account_id) values($1,$2,'100.01',$3) returning id",[f.employee,start,f.account]);
 for(const actor of [f.account,owner])expect((await request(`/advance-requests?employee_id=${f.employee}`,undefined,actor)).body.data).toMatchObject([{id,reason:null,decision_note:null}]);
 expect((await request(`/advance-requests/${id}/reject`,{note:"Legacy request declined after documented review"})).status).toBe(200);expect((await snapshot(f.employee)).requests[0]).toMatchObject({reason:null,decision_note:"Legacy request declined after documented review"});console.log(`UC12_LEGACY_FIXTURE=${JSON.stringify({employee:f.employee,key:f.key,advance:id})}`);
});
dbTest("UC12 own-scope forged employee denied with valid reason and no rows",async()=>{
 const f=await fixture(),other=await fixture();expect((await request("/advance-requests",{employee_id:other.employee,amount:"100.01",reason:"Denied forged identity"},f.account)).status).toBe(403);expect(await snapshot(other.employee)).toEqual({requests:[],audit:[]});expect((await request(`/advance-requests?employee_id=${other.employee}`,undefined,f.account)).status).toBe(403);
});
dbTest("UC12 approval retains 19/20 worked-day and half-base exact-cent guards",async()=>{
 const insufficient=await fixture(19);const first=await submit(insufficient);const before=await snapshot(insufficient.employee);expect((await request(`/advance-requests/${first.body.data.id}/approve`,{})).body.error.code).toBe("ADVANCE_WORK_DAYS_INSUFFICIENT");expect(await snapshot(insufficient.employee)).toEqual(before);
 const over=await fixture(20);const second=await submit(over,"Emergency household expenses","15000.01");const overBefore=await snapshot(over.employee);expect((await request(`/advance-requests/${second.body.data.id}/approve`,{})).body.error.code).toBe("ADVANCE_HALF_SALARY_EXCEEDED");expect(await snapshot(over.employee)).toEqual(overBefore);
 const exact=await fixture();const third=await submit(exact,"Emergency household expenses","15000.00");const approved=await request(`/advance-requests/${third.body.data.id}/approve`,{});expect(approved.status,JSON.stringify(approved.body)).toBe(200);expect(approved.body.data).toMatchObject({amount:"15000.00",reason:"Emergency household expenses",status:"approved"});
});
dbTest("UC12 projected net exactly zero approves and negative one cent rejects without decision/audit",async()=>{
 for(const [extra,code]of [["0.00",null],["0.01","ADVANCE_NEGATIVE_NET_PAY"]]as const){const f=await fixture();const monthDays=BigInt(Number(end.slice(-2)));const dailyCents=(3000000n+monthDays/2n)/monthDays;const debt=(BigInt(day!)*dailyCents-10001n+(extra==="0.01"?1n:0n));const amount=`${debt/100n}.${String(debt%100n).padStart(2,"0")}`;
 await db.query("insert into debt_transactions(employee_id,debt_type_id,transaction_kind,transaction_date,amount,description,recorded_by_user_account_id) values($1,$2,'charge',$3,$4,'UC12 projection boundary',$5)",[f.employee,debtType,start,amount,owner]);const result=await submit(f);const before=await snapshot(f.employee);const approved=await request(`/advance-requests/${result.body.data.id}/approve`,{});if(code){expect(approved.body.error?.code,JSON.stringify(approved.body)).toBe(code);expect(await snapshot(f.employee)).toEqual(before);}else{expect(approved.status,JSON.stringify(approved.body)).toBe(200);expect(approved.body.data.status).toBe("approved");}}
});
