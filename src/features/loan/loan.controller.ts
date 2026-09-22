import type { LoanActor } from "./loan.dto";
import { toLoanResponse } from "./loan.mapper";
import { LoanService } from "./loan.service";
export class LoanController {
  constructor(private readonly service: LoanService) {}
  async create(actor: LoanActor, body: {
    employee_id: number; principal_amount: string; installment_count: number;
    first_due_month: string; reason: string;
  }) {
    return toLoanResponse(await this.service.createLoan(actor, {
      employeeId: body.employee_id, principalAmount: body.principal_amount,
      installmentCount: body.installment_count, firstDueMonth: body.first_due_month,
      reason: body.reason,
    }));
  }
  async list(actor: LoanActor, employeeId: number) {
    return (await this.service.listLoans(actor, employeeId)).map(toLoanResponse);
  }
}
