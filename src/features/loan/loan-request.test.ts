import { expect, test } from "bun:test";
import { LoanRequestService } from "./loan-request.service";
import { ApplicationError } from "../../core/errors/application.error";
const fixture = () => {
 let request:any;let creates=0;
 const repository:any={async insert(command:any){request={id:1,...command,status:"pending",loanId:null};return request;},async listByEmployee(id:number){return request?.employeeId===id?[request]:[];},async withTransaction(work:any){return work();},async findForUpdate(){return request;},async decide(_id:number,values:any){request={...request,...values};return request;}};
 const access={async assertOwnOrFinance(actor:any,id:number){if(actor.accountId!==id&&actor.accountId!==99)throw new ApplicationError("FORBIDDEN_SCOPE");},async assertFinance(actor:any){if(actor.accountId!==99)throw new ApplicationError("FORBIDDEN_SCOPE");}};
 const loans:any={async createLoan(_actor:any,command:any){creates++;expect(command).toMatchObject({principalAmount:"100.01",installmentCount:3});return {loan:{id:7,...command},installments:[]};}};
 const service=new LoanRequestService(repository,loans,access);const command={employeeId:10,principalAmount:"100.01",installmentCount:3,reason:"Emergency"};
 return {service,command,get creates(){return creates;}};
};
test("employee requests and lists own requested terms",async()=>{const f=fixture();expect(await f.service.createRequest({accountId:10},f.command)).toMatchObject({...f.command,status:"pending",requestedByUserAccountId:10});expect(await f.service.listRequests({accountId:10},10)).toHaveLength(1);await expect(f.service.createRequest({accountId:11},f.command)).rejects.toMatchObject({code:"FORBIDDEN_SCOPE"});await expect(f.service.listRequests({accountId:11},10)).rejects.toMatchObject({code:"FORBIDDEN_SCOPE"});});
test("finance approval reuses requested terms and prevents duplicate loans",async()=>{const f=fixture();await f.service.createRequest({accountId:10},f.command);await expect(f.service.approveRequest({accountId:10},1,"2026-11-01")).rejects.toMatchObject({code:"FORBIDDEN_SCOPE"});expect(await f.service.approveRequest({accountId:99},1,"2026-11-01")).toMatchObject({status:"approved",loanId:7,decidedByUserAccountId:99});await expect(f.service.approveRequest({accountId:99},1,"2026-11-01")).rejects.toMatchObject({code:"LOAN_REQUEST_NOT_PENDING"});expect(f.creates).toBe(1);});
test("finance rejects with mandatory note without loan",async()=>{const f=fixture();await f.service.createRequest({accountId:10},f.command);await expect(f.service.rejectRequest({accountId:99},1," ")).rejects.toMatchObject({code:"VALIDATION_ERROR"});expect(await f.service.rejectRequest({accountId:99},1,"ไม่ผ่านเกณฑ์")).toMatchObject({status:"rejected",decisionNote:"ไม่ผ่านเกณฑ์"});expect(f.creates).toBe(0);await expect(f.service.rejectRequest({accountId:99},1,"again")).rejects.toMatchObject({code:"LOAN_REQUEST_NOT_PENDING"});});
test("request approval forbids past unlocked months and permits current business month",async()=>{
 const {bangkokToday}=await import("../../shared/operation-validation");const month=bangkokToday().slice(0,7)+"-01";
 const f=fixture();await f.service.createRequest({accountId:10},f.command);
 await expect(f.service.approveRequest({accountId:99},1,"2000-01-01")).rejects.toMatchObject({code:"LOAN_REQUEST_PAST_DUE_MONTH"});
 expect(await f.service.approveRequest({accountId:99},1,month)).toMatchObject({status:"approved"});
});
