import type { DebtService } from "./debt.service";
import { operationCommand, operationSuccess, publicOperationData } from "../../shared/operation-mapper";
import { databaseId } from "../../shared/operation-validation";
export class DebtController {
 constructor(private readonly service: Pick<DebtService,keyof DebtService>) {}
 private response(actor:any,value:any) { return operationSuccess(publicOperationData(value),actor.requestId); }

 async record(actor:any,body:any) { return this.response(actor,await this.service.record(actor,operationCommand(body))); }
 async reverse(actor:any,id:string,body:any) { return this.response(actor,await this.service.reverse(actor,databaseId(id),body.description)); }
 async list(actor:any,employeeId:string) { return this.response(actor,await this.service.getLedger(actor,databaseId(employeeId))); }
}
