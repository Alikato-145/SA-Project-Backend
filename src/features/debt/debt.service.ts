import type { DebtActor, DebtTransaction, RecordDebtCommand } from "./debt.dto";
import { DebtError, type DebtRepository } from "./debt.repository";

export type DebtAccess = {
  assertCanRecord(actor: DebtActor, employeeId: number): Promise<void>;
  assertCanRead(actor: DebtActor, employeeId: number): Promise<void>;
};
const cents = (value: string): bigint => {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new DebtError("DEBT_INVALID_AMOUNT");
  const [whole, fraction = ""] = value.split(".");
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (result <= 0n) throw new DebtError("DEBT_INVALID_AMOUNT");
  return result;
};
const money = (value: bigint) => `${value < 0n ? "-" : ""}${(value < 0n ? -value : value) / 100n}.${String((value < 0n ? -value : value) % 100n).padStart(2, "0")}`;
const validDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};
export class DebtService {
  constructor(private readonly repository: DebtRepository, private readonly access: DebtAccess,
    private readonly today: () => string) {}
  async record(actor: DebtActor, command: RecordDebtCommand) {
    cents(command.amount);
    if (!command.description.trim() || !validDate(this.today())) throw new DebtError("DEBT_INVALID_ENTRY");
    await this.access.assertCanRecord(actor, command.employeeId);
    return this.repository.withTransaction(async (session) => {
      const type = await session.findType(command.debtTypeId);
      if (!type?.isActive) throw new DebtError("DEBT_TYPE_UNAVAILABLE");
      return session.insert({ ...command, transactionDate: this.today(),
        originalTransactionId: null, recordedByUserAccountId: actor.accountId });
    });
  }
  async reverse(actor: DebtActor, id: number, description: string) {
    if (!description.trim()) throw new DebtError("DEBT_INVALID_ENTRY");
    return this.repository.withTransaction(async (session) => {
      const original = await session.findByIdForUpdate(id);
      if (!original || original.transactionKind === "reversal") throw new DebtError("DEBT_NOT_FOUND");
      await this.access.assertCanRecord(actor, original.employeeId);
      if (original.settledAt || original.settledInPayrollRecordId) throw new DebtError("DEBT_ALREADY_SETTLED");
      if (await session.hasReversal(id)) throw new DebtError("DEBT_ALREADY_REVERSED");
      return session.insert({ employeeId: original.employeeId, debtTypeId: original.debtTypeId,
        transactionKind: "reversal", transactionDate: this.today(), description,
        amount: original.amount, originalTransactionId: id,
        recordedByUserAccountId: actor.accountId });
    });
  }
  async getLedger(actor: DebtActor, employeeId: number) {
    await this.access.assertCanRead(actor, employeeId);
    const entries = await this.repository.listByEmployee(employeeId);
    const balance = entries.reduce((sum, row) => sum +
      (row.transactionKind === "reversal" ? -cents(row.amount) : cents(row.amount)), 0n);
    return { entries, balance: money(balance) };
  }
  async findCandidatesForPayroll(actor: DebtActor, employeeId: number, periodEnd: string): Promise<DebtTransaction[]> {
    await this.access.assertCanRead(actor, employeeId);
    const entries = await this.repository.listByEmployee(employeeId);
    const reversed = new Set(entries.filter((row) => row.transactionKind === "reversal")
      .map((row) => row.originalTransactionId));
    return entries.filter((row) => row.transactionKind !== "reversal" &&
      row.transactionDate <= periodEnd && !row.settledAt &&
      !row.settledInPayrollRecordId && !reversed.has(row.id));
  }
}
