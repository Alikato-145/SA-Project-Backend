import { toAdvanceResponse } from "./advance.mapper";
import type { AdvanceRecord } from "./advance.dto";
import type { AdvanceService } from "./advance.service";
import { operationSuccess } from "../../shared/operation-mapper";
import { databaseId } from "../../shared/operation-validation";
export class AdvanceController {
 constructor(private readonly service: Pick<AdvanceService,keyof AdvanceService>) {}
 private response(actor:any,value:AdvanceRecord | AdvanceRecord[]) { return operationSuccess(Array.isArray(value) ? value.map(toAdvanceResponse) : toAdvanceResponse(value),actor.requestId); }

 async submit(actor:any,body:any) { return this.response(actor,await this.service.submitAdvance(actor,databaseId(body.employee_id),body.amount,body.reason)); }
 async approve(actor:any,id:string) { return this.response(actor,await this.service.approveAdvance(actor,databaseId(id))); }
 async reject(actor:any,id:string,body:any) { return this.response(actor,await this.service.rejectAdvance(actor,databaseId(id),body.note)); }
 async list(actor:any,employeeId:string) { return this.response(actor,await this.service.listRequests(actor,databaseId(employeeId))); }
}
