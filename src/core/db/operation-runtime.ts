import { operationTransaction } from "./operation-context";
import type { PayrollInputService } from "../../features/payroll/payroll.service";
import type { DomainAuditObserver } from "../audit/domain-audit-observer";
import type { OperationActor } from "../auth/operation-actor";
import { createActionContext } from "../audit/action-context";
import type { EmployeeOperationContextService } from "../../features/employee/employee.operation-context.service";
export interface OperationRuntime {
 context:EmployeeOperationContextService;
 payroll:PayrollInputService;
 domain:DomainAuditObserver;
}
/** Transaction/audit plumbing; feature services supply policy, target and facts. */
export const runOperation = <T>(runtime:OperationRuntime,actor:OperationActor,feature:string,action:string,table:string,work:()=>Promise<{value:T;oldData?:Record<string,unknown>}>):Promise<T> => operationTransaction(async executor=>{
 await runtime.payroll.serialize(executor);
 const {value,oldData}=await work();
 const record=value as any;
 await runtime.domain.record(executor,createActionContext({actorAccountId:String(actor.accountId),requestId:actor.requestId ?? crypto.randomUUID(),actionBase:`${feature}.record.${action}`,target:{tableName:table,recordId:String(record?.id ?? record?.loan?.id ?? "collection")}}),{oldData,newData:value && typeof value==="object" ? value as Record<string,unknown> : {value}});
 return value;
});
