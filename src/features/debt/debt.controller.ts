import type { DebtService } from "./debt.service";
import type { createDebtRuntimeService } from "./debt.runtime.service";
import { operationCommand, operationSuccess, publicOperationData } from "../../shared/operation-mapper";
import { databaseId } from "../../shared/operation-validation";
export class DebtController {
 constructor(private readonly service: ReturnType<typeof createDebtRuntimeService>) {}
 private response(actor:any,value:any) { return operationSuccess(publicOperationData(value),actor.requestId); }

 async record(actor:any,body:any) { return this.response(actor,await this.service.record(actor,operationCommand(body))); }
 async reverse(actor:any,id:string,body:any) { return this.response(actor,await this.service.reverse(actor,databaseId(id),body.description)); }
 async list(actor:any,employeeId:string) { return this.response(actor,await this.service.getLedger(actor,databaseId(employeeId))); }
 async types(actor:any) { return this.response(actor,await this.service.listTypes(actor)); }
 async managedTypes(actor:any) { return this.response(actor,await this.service.listManagedTypes(actor)); }
 async saveType(actor:any,body:any,id?:string) { return this.response(actor,await this.service.saveType(actor,operationCommand(body),id ? databaseId(id):undefined)); }
}
