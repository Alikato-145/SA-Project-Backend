import type { AdvanceActor } from "./advance.dto";
import { toAdvanceResponse } from "./advance.mapper";
import { AdvanceService } from "./advance.service";
export class AdvanceController {
  constructor(private readonly service: AdvanceService) {}
  async submit(actor: AdvanceActor, body: { employee_id: number; amount: string }) {
    return toAdvanceResponse(await this.service.submitAdvance(actor, body.employee_id, body.amount));
  }
  async approve(actor: AdvanceActor, id: number) {
    return toAdvanceResponse(await this.service.approveAdvance(actor, id));
  }
  async reject(actor: AdvanceActor, id: number, body: { note?: string }) {
    return toAdvanceResponse(await this.service.rejectAdvance(actor, id, body.note));
  }
  async list(actor: AdvanceActor, employeeId: number) {
    return (await this.service.listRequests(actor, employeeId)).map(toAdvanceResponse);
  }
}
