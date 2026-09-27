import type { AdvanceActor } from "./advance.dto";
import { AdvanceError, type AdvanceRepository } from "./advance.repository";

export type AdvanceAccess = {
  assertCanRequest(actor: AdvanceActor, employeeId: number): Promise<void>;
  assertCanDecide(actor: AdvanceActor, employeeId: number, date: string): Promise<void>;
  assertCanRead(actor: AdvanceActor, employeeId: number): Promise<void>;
};
export type AdvanceEligibility = {
  getWorkedDays(actor: AdvanceActor, employeeId: number, monthStart: string, requestDate: string): Promise<number>;
  getBaseSalary(employeeId: number, requestDate: string): Promise<string>;
};
export type AdvanceProjection = {
  netPayAfterAdvance(employeeId: number, month: string, amount: string): Promise<string>;
};
const cents = (value: string, allowNegative = false): bigint => {
  const pattern = allowNegative ? /^-?\d+(?:\.\d{1,2})?$/ : /^\d+(?:\.\d{1,2})?$/;
  if (!pattern.test(value)) throw new AdvanceError("INVALID_ADVANCE_AMOUNT");
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return negative ? -amount : amount;
};
const bangkokDate = (value: Date) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(value);
  const field = (name: string) => parts.find((part) => part.type === name)?.value ?? "";
  return `${field("year")}-${field("month")}-${field("day")}`;
};
export class AdvanceService {
  constructor(
    private readonly repository: AdvanceRepository,
    private readonly access: AdvanceAccess,
    private readonly eligibility: AdvanceEligibility,
    private readonly projection: AdvanceProjection,
    private readonly today: () => string = () => bangkokDate(new Date()),
  ) {}
  async submitAdvance(actor: AdvanceActor, employeeId: number, amount: string) {
    const date = this.today();
    this.assertEligibleDate(date);
    if (cents(amount) <= 0n) throw new AdvanceError("INVALID_ADVANCE_AMOUNT");
    await this.access.assertCanRequest(actor, employeeId);
    return this.repository.insert({
      employeeId, amount, requestMonth: `${date.slice(0, 7)}-01`,
      requestedByUserAccountId: actor.accountId,
    });
  }
  async approveAdvance(actor: AdvanceActor, id: number) {
    const request = await this.requirePending(id);
    const date = bangkokDate(request.requestedAt);
    await this.access.assertCanDecide(actor, request.employeeId, date);
    this.assertEligibleDate(date);
    const worked = await this.eligibility.getWorkedDays(actor, request.employeeId, request.requestMonth, date);
    if (worked < 20) throw new AdvanceError("ADVANCE_WORK_DAYS_INSUFFICIENT");
    const amount = cents(request.amount);
    const salary = cents(await this.eligibility.getBaseSalary(request.employeeId, date));
    if (amount * 2n > salary) throw new AdvanceError("ADVANCE_HALF_SALARY_EXCEEDED");
    const net = cents(await this.projection.netPayAfterAdvance(
      request.employeeId, request.requestMonth, request.amount,
    ), true);
    if (net < 0n) throw new AdvanceError("ADVANCE_NEGATIVE_NET_PAY");
    return this.repository.decide(id, "approved", actor.accountId);
  }
  async rejectAdvance(actor: AdvanceActor, id: number, note?: string) {
    const request = await this.requirePending(id);
    await this.access.assertCanDecide(actor, request.employeeId, bangkokDate(request.requestedAt));
    return this.repository.decide(id, "rejected", actor.accountId, note);
  }
  async listRequests(actor: AdvanceActor, employeeId: number) {
    await this.access.assertCanRead(actor, employeeId);
    return this.repository.listByEmployee(employeeId);
  }
  async findApprovedForPayroll(actor: AdvanceActor, employeeId: number, month: string) {
    await this.access.assertCanRead(actor, employeeId);
    return this.repository.findApprovedForMonth(employeeId, month);
  }
  private assertEligibleDate(date: string) {
    if (!/^\d{4}-\d{2}-(?:2\d|3[01])$/.test(date)) {
      throw new AdvanceError("ADVANCE_INELIGIBLE_DATE");
    }
  }
  private async requirePending(id: number) {
    const record = await this.repository.findById(id);
    if (!record) throw new AdvanceError("ADVANCE_NOT_FOUND");
    if (record.status !== "pending") throw new AdvanceError("ADVANCE_NOT_PENDING");
    return record;
  }
}
