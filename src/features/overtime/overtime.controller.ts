import type { OvertimeService } from "./overtime.service";
import { operationCommand, operationSuccess, publicOperationData } from "../../shared/operation-mapper";
import { databaseId } from "../../shared/operation-validation";
import type { createOvertimeRuntimeService } from "./overtime.runtime.service";
export class OvertimeController {
 constructor(private readonly service: ReturnType<typeof createOvertimeRuntimeService>) {}
 private response(actor:any,value:any) { return operationSuccess(publicOperationData(value),actor.requestId); }

 async submit(actor:any,body:any) { return this.response(actor,await this.service.submitOvertime(actor,operationCommand(body))); }
 async approve(actor:any,id:string,body:any) { return this.response(actor,await this.service.approveOvertime(actor,databaseId(id),body.remark)); }
 async reject(actor:any,id:string,body:any) { return this.response(actor,await this.service.rejectOvertime(actor,databaseId(id),body.remark)); }
 async list(actor:any,employeeId:string) { return this.response(actor,await this.service.listRequests(actor,databaseId(employeeId))); }
 async history(actor:any,id:string) { return this.response(actor,await this.service.getHistory(actor,databaseId(id))); }
}
