import type { OperationActor } from "../../core/auth/operation-actor";
import { parseActiveGrant } from "../../core/auth/authorization";
import { ApplicationError } from "../../core/errors/application.error";
import { realDate } from "../../shared/operation-validation";
import { employeeOperationContextRepository } from "./employee.operation-context.repository";
type Repository = typeof employeeOperationContextRepository;
export const createEmployeeOperationContextService = (repository: Repository = employeeOperationContextRepository) => {
 const trusted = (actor: OperationActor) => { if (!actor.trustedActor) throw new ApplicationError("AUTH_REQUIRED"); return actor.trustedActor; };
 const globals = (actor: OperationActor) => trusted(actor).grants.some(candidate => { const grant=parseActiveGrant(candidate); return grant?.scope === "all" && ["HR","OWNER"].includes(grant.roleCode); });
 const service = {
  async context(employeeId:number,date:string) { const row=await repository.datedAssignment(employeeId,realDate(date)); if (!row) throw new ApplicationError("PAYROLL_ASSIGNMENT_MISSING"); return row; },
  async assertEmployee(actor:OperationActor,employeeId:number,date:string, action:"read"|"submit"|"manage"|"decide"|"finance") {
   const authenticated=trusted(actor);
   if (action === "finance") { if (!globals(actor)) throw new ApplicationError("FORBIDDEN_SCOPE"); return "all" as const; }
   if (["read","submit"].includes(action) && authenticated.employeeId === String(employeeId) && authenticated.grants.some(g => parseActiveGrant(g)?.scope === "self")) return "self" as const;
   if(globals(actor))return "all" as const;
   const row=await service.context(employeeId,date);
   const matches=authenticated.grants.map(parseActiveGrant).filter(grant => grant && ((grant.scope === "all" && ["HR","OWNER"].includes(grant.roleCode)) || (grant.branchId === String(row.branchId) && (grant.scope === "branch" || (grant.scope === "department" && grant.departmentId === String(row.departmentId))))));
   const grant=matches.find(grant=>grant?.scope === "all") ?? matches.find(grant=>grant?.scope === "branch") ?? matches[0];
   if (!grant) throw new ApplicationError("FORBIDDEN_SCOPE");
   return grant.scope;
  },
  async visibleWorkDays<T extends {employeeId:number;workDate:string}>(actor:OperationActor,rows:T[]):Promise<T[]> {
   const visible:T[]=[];
   for(const row of rows) {try {await service.assertEmployee(actor,row.employeeId,row.workDate,"read");visible.push(row);}catch(error){if(!(error instanceof ApplicationError)||error.code!=="FORBIDDEN_SCOPE")throw error;}}
   return visible;
  },
  async assertBranch(actor:OperationActor,branchId:number, read=false) { const user=trusted(actor); if (globals(actor) || user.grants.some(g=>{const grant=parseActiveGrant(g);return grant?.branchId===String(branchId) && (grant.scope==="branch" || (read && grant.scope==="department"));})) return; throw new ApplicationError("FORBIDDEN_SCOPE"); },
  async assertShop(actor:OperationActor,shopId:number,read=false) { if(globals(actor))return; if(read) { const branchIds=await repository.shopBranches(shopId); for(const branch of branchIds) { try { await service.assertBranch(actor,branch,true); return; } catch {} } } throw new ApplicationError("FORBIDDEN_SCOPE"); },
  assertGlobal(actor:OperationActor) { if(!globals(actor))throw new ApplicationError("FORBIDDEN_SCOPE"); },
  branchShop: repository.branchShop,
  weeklyHoliday: repository.weeklyHoliday,
 };
 return service;
};
export type EmployeeOperationContextService = ReturnType<typeof createEmployeeOperationContextService>;
