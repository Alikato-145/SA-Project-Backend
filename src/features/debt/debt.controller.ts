import type { DebtActor } from "./debt.dto";
import { toDebtResponse } from "./debt.mapper";
import { DebtService } from "./debt.service";
export class DebtController {
  constructor(private readonly service: DebtService) {}
  async record(actor: DebtActor, body: {
    employee_id: number; debt_type_id: number; transaction_kind: "charge" | "adjustment";
    amount: string; description: string;
  }) {
    return toDebtResponse(await this.service.record(actor, {
      employeeId: body.employee_id, debtTypeId: body.debt_type_id,
      transactionKind: body.transaction_kind, amount: body.amount,
      description: body.description,
    }));
  }
  async reverse(actor: DebtActor, id: number, body: { description: string }) {
    return toDebtResponse(await this.service.reverse(actor, id, body.description));
  }
  async list(actor: DebtActor, employeeId: number) {
    const ledger = await this.service.getLedger(actor, employeeId);
    return { entries: ledger.entries.map(toDebtResponse), balance: ledger.balance };
  }
}
