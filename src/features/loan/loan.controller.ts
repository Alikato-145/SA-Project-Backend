import { toLoanResponse } from "./loan.mapper";
import type { LoanService } from "./loan.service";
import { operationCommand, operationSuccess, publicOperationData } from "../../shared/operation-mapper";
import { databaseId } from "../../shared/operation-validation";
export class LoanController {
 constructor(private readonly service: Pick<LoanService,keyof LoanService>) {}
 private response(actor:any,value:any) { return operationSuccess(publicOperationData(value),actor.requestId); }

 async create(actor:any,body:any) { return this.response(actor,toLoanResponse(await this.service.createLoan(actor,operationCommand(body)))); }
 async list(actor:any,employeeId:string) { return this.response(actor,(await this.service.listLoans(actor,databaseId(employeeId))).map(toLoanResponse)); }
}
