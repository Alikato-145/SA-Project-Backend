import { expect, test } from "bun:test";
import { AdvanceService } from "./advance.service";
import { AdvanceController } from "./advance.controller";
import { createAdvanceRoutes } from "./advance.routes";
import type { AdvanceRecord } from "./advance.dto";

const fixture = () => {
  let inserts = 0, decisions = 0;
  const row: AdvanceRecord = { id:1,employeeId:10,requestMonth:"2026-10-01",amount:"100.01",reason:null,status:"pending",requestedByUserAccountId:2,requestedAt:new Date("2026-10-20T03:00:00Z"),decidedByUserAccountId:null,decidedAt:null,decisionNote:null,createdAt:new Date(),updatedAt:new Date() };
  const service = new AdvanceService({
    async insert(command) { inserts++; return {...row,...command}; }, async findById() { return row; },
    async decide(_id,status,_actor,note) { decisions++; return {...row,status,decisionNote:note ?? null}; },
    async listByEmployee() { return [row]; },async findApprovedForMonth() { return []; },
  },{async assertCanRequest(){},async assertCanDecide(){},async assertCanRead(){}},{async getWorkedDays(){return 20;},async getBaseSalary(){return "30000.00";}},{async netPayAfterAdvance(){return "0.00";}},()=>"2026-10-26");
  const app = createAdvanceRoutes({controller:new AdvanceController(service),allowedOrigins:["http://localhost:3000"],authenticate:async()=>({accountId:"2",employeeId:"10",username:"synthetic",grants:[]})});
  const request = async(path:string,data:object) => app.handle(new Request(`http://localhost:3000/api/v1${path}`,{method:"POST",headers:{origin:"http://localhost:3000","content-type":"application/json"},body:JSON.stringify(data)}));
  return {request,get inserts(){return inserts;},get decisions(){return decisions;}};
};
for(const reason of [undefined,null,""," \n\t ","x".repeat(1001)])test(`UC12 API rejects invalid reason ${JSON.stringify(reason)?.slice(0,25)} without write`,async()=>{
 const f=fixture(); const response=await f.request("/advance-requests",{employee_id:"10",amount:"100.01",...(reason===undefined?{}:{reason})});
 expect(response.status).toBe(422);expect((await response.json()).error.code).toBe("VALIDATION_ERROR");expect(f.inserts).toBe(0);
});
for(const note of [undefined,null,""," \n\t ","x".repeat(1001)])test(`UC12 API rejects invalid decision note ${JSON.stringify(note)?.slice(0,25)} without decision`,async()=>{
 const f=fixture(); const response=await f.request("/advance-requests/1/reject",note===undefined?{}:{note});
 expect(response.status).toBe(422);expect((await response.json()).error.code).toBe("VALIDATION_ERROR");expect(f.decisions).toBe(0);
});
test("UC12 API sends persisted reason and decision note in snake_case without internal actor metadata",async()=>{
 const f=fixture();const submitted=await f.request("/advance-requests",{employee_id:"10",amount:"100.01",reason:"  Emergency household expenses  "});
 expect(submitted.status).toBe(200);expect((await submitted.json()).data).toMatchObject({employee_id:"10",reason:"Emergency household expenses"});
 const rejected=await f.request("/advance-requests/1/reject",{note:"  Payment capacity insufficient  "});expect(rejected.status).toBe(200);
 const data=(await rejected.json()).data;expect(data).toMatchObject({reason:null,decision_note:"Payment capacity insufficient",status:"rejected"});expect(data).not.toHaveProperty("requested_by_user_account_id");
});
