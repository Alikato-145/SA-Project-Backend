import type { LeaveActor } from "./leave.dto";
import { toLeaveResponse } from "./leave.mapper";
import { LeaveService } from "./leave.service";

export class LeaveController {
  constructor(private readonly service: LeaveService) {}
  async submit(actor: LeaveActor, body: {
    employee_id: number; leave_type_id: number; start_date: string;
    end_date: string; reason?: string; is_retroactive?: boolean;
  }) {
    return toLeaveResponse(await this.service.submitLeave(actor, {
      employeeId: body.employee_id, leaveTypeId: body.leave_type_id,
      startDate: body.start_date, endDate: body.end_date, reason: body.reason,
      isRetroactive: body.is_retroactive,
    }));
  }
  async approve(actor: LeaveActor, id: number, body: { final_leave_type_id?: number }) {
    return toLeaveResponse(await this.service.approveLeave(actor, id, body.final_leave_type_id));
  }
  async reject(actor: LeaveActor, id: number, body: { remark?: string }) {
    return toLeaveResponse(await this.service.rejectLeave(actor, id, body.remark));
  }
  async list(actor: LeaveActor, employeeId: number) {
    return (await this.service.listRequests(actor, employeeId)).map(toLeaveResponse);
  }
}
