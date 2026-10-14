import type { LeaveService } from "./leave.service";
import { operationCommand, operationSuccess, publicOperationData } from "../../shared/operation-mapper";
import { databaseId } from "../../shared/operation-validation";
import type { createLeaveRuntimeService } from "./leave.runtime.service";
export class LeaveController {
 constructor(private readonly service: ReturnType<typeof createLeaveRuntimeService>) {}
 private response(actor:any,value:any) { return operationSuccess(publicOperationData(value),actor.requestId); }

 async submit(actor:any,body:any) { return this.response(actor,await this.service.submitLeave(actor,operationCommand(body))); }
 async update(actor:any,id:string,body:any) { return this.response(actor,await this.service.updateLeave(actor,databaseId(id),operationCommand(body))); }
 async approve(actor:any,id:string,body:any) { return this.response(actor,await this.service.approveLeave(actor,databaseId(id),body.final_leave_type_id ? databaseId(body.final_leave_type_id):undefined,body.remark)); }
 async reject(actor:any,id:string,body:any) { return this.response(actor,await this.service.rejectLeave(actor,databaseId(id),body.remark)); }
 async list(actor:any,employeeId:string) { return this.response(actor,await this.service.listRequests(actor,databaseId(employeeId))); }
 async types(actor:any) { return this.response(actor,await this.service.listTypes(actor)); }
 async managedTypes(actor:any) { return this.response(actor,await this.service.listManagedTypes(actor)); }
 async saveType(actor:any,body:any,id?:string) { return this.response(actor,await this.service.saveType(actor,operationCommand(body),id ? databaseId(id):undefined)); }
 async setQuota(actor:any,body:any) { return this.response(actor,await this.service.setQuota(actor,databaseId(body.employee_id),databaseId(body.leave_type_id),Number(body.quota_year),body.entitled_days)); }
 async quotas(actor:any,employeeId:string,year:string) { return this.response(actor,await this.service.listQuotas(actor,databaseId(employeeId),Number(year))); }
 async history(actor:any,id:string) { return this.response(actor,await this.service.getHistory(actor,databaseId(id))); }
}
