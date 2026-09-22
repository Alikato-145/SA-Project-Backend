import type { OvertimeActor } from "./overtime.dto";
import { toOvertimeResponse } from "./overtime.mapper";
import { OvertimeService } from "./overtime.service";

export class OvertimeController {
  constructor(private readonly service: OvertimeService) {}
  async submit(actor: OvertimeActor, body: {
    employee_id: number; overtime_date: string; overtime_type: "hourly" | "rest_day" | "public_holiday";
    hours?: string; day_units?: string; work_day_record_id?: number; reason?: string;
  }) {
    return toOvertimeResponse(await this.service.submitOvertime(actor, {
      employeeId: body.employee_id, overtimeDate: body.overtime_date,
      overtimeType: body.overtime_type, hours: body.hours ?? null, dayUnits: body.day_units ?? null,
      workDayRecordId: body.work_day_record_id, reason: body.reason,
    }));
  }
  async approve(actor: OvertimeActor, id: number, body: { remark?: string }) {
    return toOvertimeResponse(await this.service.approveOvertime(actor, id, body.remark));
  }
  async reject(actor: OvertimeActor, id: number, body: { remark?: string }) {
    return toOvertimeResponse(await this.service.rejectOvertime(actor, id, body.remark));
  }
  async list(actor: OvertimeActor, employeeId: number) {
    return (await this.service.listRequests(actor, employeeId)).map(toOvertimeResponse);
  }
}
