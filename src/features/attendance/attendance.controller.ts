import type { AttendanceService } from "./attendance.service";
import { operationCommand, operationSuccess, publicOperationData } from "../../shared/operation-mapper";
import { databaseId } from "../../shared/operation-validation";
const instant=(value:any) => value == null ? value : new Date(value);
export class AttendanceController {
 constructor(private readonly service: Pick<AttendanceService,keyof AttendanceService>) {}
 private response(actor:any,value:any) { return operationSuccess(publicOperationData(value),actor.requestId); }

 async create(input:any) { const command=operationCommand(input.command); return this.response(input.actor, await this.service.createManualWorkDay(input.actor,{...command,clockInAt:instant(command.clockInAt),clockOutAt:instant(command.clockOutAt)})); }
 async correct(input:any) { const command=operationCommand(input.command); if(command.clockInAt!==undefined)command.clockInAt=instant(command.clockInAt); if(command.clockOutAt!==undefined)command.clockOutAt=instant(command.clockOutAt); return this.response(input.actor,await this.service.correctWorkDay(input.actor,databaseId(input.id),command)); }
 async list(input:any) { return this.response(input.actor,await this.service.findForPayrollRange(input.actor,operationCommand(input.filter))); }
}
