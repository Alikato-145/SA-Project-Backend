import type { LoanRequestService } from "./loan-request.service";
import { toLoanRequestResponse } from "./loan-request.mapper";
import { operationCommand, operationSuccess, publicOperationData } from "../../shared/operation-mapper";
import { databaseId } from "../../shared/operation-validation";
export class LoanRequestController {
 constructor(private readonly service:Pick<LoanRequestService,"createRequest"|"listRequests"|"approveRequest"|"rejectRequest">) {}
 private response(actor:any,value:any) {return operationSuccess(publicOperationData(value),actor.requestId);}
 async create(actor:any,body:any){return this.response(actor,toLoanRequestResponse(await this.service.createRequest(actor,operationCommand(body))));}
 async list(actor:any,employeeId:string){return this.response(actor,(await this.service.listRequests(actor,databaseId(employeeId))).map(toLoanRequestResponse));}
 async approve(actor:any,id:string,body:any){return this.response(actor,toLoanRequestResponse(await this.service.approveRequest(actor,databaseId(id),body.first_due_month)));}
 async reject(actor:any,id:string,body:any){return this.response(actor,toLoanRequestResponse(await this.service.rejectRequest(actor,databaseId(id),body.decision_note)));}
}
