import type { BranchScheduleService } from "./branch-schedule.service";
import { operationCommand, operationSuccess, publicOperationData } from "../../shared/operation-mapper";
import { databaseId } from "../../shared/operation-validation";
export class BranchScheduleController {
 constructor(private readonly service: Pick<BranchScheduleService,keyof BranchScheduleService>) {}
 private response(actor:any,value:any) { return operationSuccess(publicOperationData(value),actor.requestId); }

 async create(input:any) { return this.response(input.actor,await this.service.createSchedule(input.actor,operationCommand(input.command))); }
 async update(input:any) { return this.response(input.actor,await this.service.updateSchedule(input.actor,databaseId(input.id),operationCommand(input.command))); }
 async list(input:any) { return this.response(input.actor,await this.service.listSchedules(input.actor,databaseId(input.branchId),input.workDate)); }
 async findApplicable(input:any) { return this.response(input.actor,await this.service.findApplicableSchedule(input.actor,databaseId(input.branchId),input.workDate)); }
 async upsertOverride(input:any) { return this.response(input.actor,await this.service.upsertOverride(input.actor,{...operationCommand(input.command),branchId:databaseId(input.branchId),scheduleDate:input.scheduleDate})); }
}
