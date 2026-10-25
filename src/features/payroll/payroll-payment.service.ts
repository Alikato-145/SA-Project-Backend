import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { createActionContext } from "../../core/audit/action-context";
import type { ActionObserver } from "../../core/audit/action-observer";
import type { DomainAuditObserver } from "../../core/audit/domain-audit-observer";
import type { DatabaseExecutor, TransactionRunner } from "../../core/db/transaction";
import { ApplicationError } from "../../core/errors/application.error";
import type { EmployeePaymentDestination } from "../employee/employee.payment-destination";
import { assertPayrollMutationAccess } from "./payroll.authorization";
import { serializePayrollInputs } from "./payroll.input-lock.repository";
import { promptpayPayload } from "./payroll-payment.promptpay";
import type { PayrollPaymentRepository } from "./payroll-payment.repository";
import type { NewPayment, PaymentCommand, PaymentGroupRow, PaymentLifecycleCommand, PaymentSummary, PaymentSummaryCounts } from "./payroll-payment.types";
interface DestinationCommand {
  actor: AuthenticatedActor;
  requestId: string;
  employeeId: string;
}
interface BankSnapshot {
  id: string;
  bankCode: string;
  accountHolderName: string;
  accountNumberCiphertext: string;
  accountNumberLast4: string;
}
export interface PayrollPaymentDependencies {
  rootExecutor: DatabaseExecutor;
  transactionRunner: TransactionRunner;
  repository: PayrollPaymentRepository;
  actions: ActionObserver;
  domain: DomainAuditObserver;
  employee: {
    getPaymentDestinationInTransaction(e: DatabaseExecutor, c: DestinationCommand): Promise<EmployeePaymentDestination>;
  };
  bank: {
    getPrimaryPaymentSnapshot(e: DatabaseExecutor, c: DestinationCommand): Promise<BankSnapshot | null>;
  };
}
export const createPayrollPaymentService = (d: PayrollPaymentDependencies) => {
  const context = (c: {
    actor: AuthenticatedActor;
    requestId: string;
  }, action: string, id: string) => createActionContext({ actor: c.actor, requestId: c.requestId, actionBase: action, target: { tableName: "payroll_payments", recordId: id } });
  const load = async (e: DatabaseExecutor, c: PaymentCommand): Promise<PaymentGroupRow[]> => {
    const period = await d.repository.period(e, c.periodId);
    if (!period)
      throw new ApplicationError("RESOURCE_NOT_FOUND");
    if (period.status !== "locked")
      throw new ApplicationError("PAYMENT_PERIOD_NOT_LOCKED");
    const rows = await d.repository.records(e, c.periodId, c.branchId);
    const result: PaymentGroupRow[] = [];
    for (const row of rows) {
      const destination = row.payment ? { paymentMethod: row.payment.paymentMethod, promptpayPhone: row.payment.promptpayPhoneSnapshot } : await d.employee.getPaymentDestinationInTransaction(e, { ...c, employeeId: row.employeeId });
      const group = row.member ? "social_security" : destination.paymentMethod;
      let missingDestination: string | null = null;
      if (!row.payment && row.amount !== "0.00" && destination.paymentMethod === "transfer") {
        if (!row.member && !destination.promptpayPhone)
          missingDestination = "ลงทะเบียนเบอร์รับ PromptPay ที่หน้าพนักงาน";
        if (row.member && !(await d.bank.getPrimaryPaymentSnapshot(e, { ...c, employeeId: row.employeeId })))
          missingDestination = "เพิ่มบัญชีธนาคารหลักที่ใช้งานได้ที่หน้าพนักงาน";
      }
      result.push({ ...row, branchId: row.payment?.branchIdSnapshot ?? row.branchId, amount: row.payment?.amount ?? row.amount, group, paymentMethod: destination.paymentMethod, missingDestination });
    }
    return result;
  };
  const listPaymentGroups = async (c: PaymentCommand) => {
    assertPayrollMutationAccess(c.actor);
    return d.actions.observeRead(context(c, "payroll.payment.list", c.periodId), () => d.transactionRunner.transaction(async e => {
      // load locks destinations; serialize before any row lock across historical periods.
      await serializePayrollInputs(e);
      return load(e, c);
    }));
  };
  const transition = async (c: PaymentLifecycleCommand, status: "paid" | "cancelled", detail: string | null) => {
    const action = status === "paid" ? "payroll.payment.confirm" : "payroll.payment.cancel";
    // Attempt logging is separate from the single transactional domain transition event.
    return d.actions.observeRead(context(c, `${action}_attempt`, c.paymentId), () => d.transactionRunner.transaction(async e => {
      await serializePayrollInputs(e);
      const payment = await d.repository.findIncludingHistory(e, c.paymentId);
      if (!payment) throw new ApplicationError("RESOURCE_NOT_FOUND");
      if (payment.status === status && (status === "paid" ? payment.referenceNo : payment.cancellationReason) === detail) return payment;
      if (payment.status !== "prepared") throw new ApplicationError("PAYMENT_STATE_CONFLICT");
      const changed = await d.repository.transition(e, c.paymentId, status === "paid"
        ? { status, paidAt: new Date(), paidByUserAccountId: Number(c.actor.accountId), referenceNo: detail }
        : { status, cancelledAt: new Date(), cancelledByUserAccountId: Number(c.actor.accountId), cancellationReason: detail });
      if (!changed) throw new ApplicationError("PAYMENT_STATE_CONFLICT");
      await d.domain.record(e, context(c, action, c.paymentId), { oldData: { status: "prepared" }, newData: { status, payroll_record_id: String(payment.payrollRecordId), ...(status === "paid" ? { reference_no: detail } : { cancellation_reason: detail }) } });
      return changed;
    }));
  };
  return {
    listPaymentGroups,
    async confirmPayrollPayment(c: PaymentLifecycleCommand & { referenceNo?: string }) {
      assertPayrollMutationAccess(c.actor);
      const reference = c.referenceNo?.trim() || null;
      if (reference && reference.length > 200) throw new ApplicationError("VALIDATION_ERROR");
      return transition(c, "paid", reference);
    },
    async cancelPreparedPayrollPayment(c: PaymentLifecycleCommand & { reason: string }) {
      assertPayrollMutationAccess(c.actor);
      const reason = c.reason.trim();
      if (!reason || reason.length > 1000) throw new ApplicationError("VALIDATION_ERROR");
      return transition(c, "cancelled", reason);
    },
    async getPaymentSummary(c: PaymentCommand): Promise<PaymentSummary> {
      assertPayrollMutationAccess(c.actor);
      return d.actions.observeRead(context(c, "payroll.payment.summary", c.periodId), () => d.transactionRunner.transaction(async e => {
        await serializePayrollInputs(e);
        const period = await d.repository.period(e, c.periodId);
        if (!period) throw new ApplicationError("RESOURCE_NOT_FOUND");
        if (period.status !== "locked") throw new ApplicationError("PAYMENT_PERIOD_NOT_LOCKED");
        const rows = await d.repository.records(e, c.periodId, c.branchId);
        const counts = (records: typeof rows): PaymentSummaryCounts => {
          let payable = 0n, paid = 0n, payableCount = 0, paidCount = 0;
          for (const r of records) {
            const amount = BigInt(r.amount.replace(".", ""));
            if (amount > 0n) { payable += amount; payableCount++; }
            if (amount > 0n && r.payment?.status === "paid") { paid += BigInt(r.payment.amount.replace(".", "")); paidCount++; }
          }
          const money = (n: bigint) => `${n / 100n}.${String(n % 100n).padStart(2, "0")}`;
          return { employeeCount: records.length, payableCount, paidCount, outstandingCount: payableCount - paidCount, totalPayable: money(payable), totalPaid: money(paid), totalOutstanding: money(payable - paid), complete: payableCount === paidCount };
        };
        const branchIds = [...new Set(rows.map(r => r.payment?.branchIdSnapshot ?? r.branchId))];
        return { branches: branchIds.map(branchId => { const records = rows.filter(r => (r.payment?.branchIdSnapshot ?? r.branchId) === branchId); return { branchId, branchName: records[0]!.branchName, ...counts(records) }; }), totals: counts(rows) };
      }));
    },
    async preparePayrollPayments(c: PaymentCommand) {
      assertPayrollMutationAccess(c.actor);
      const ctx = context(c, "payroll.payment.prepare", c.periodId);
      return d.actions.observeMutation(ctx, () => d.transactionRunner.transaction(async (e) => {
        await serializePayrollInputs(e);
        const rows = await load(e, c);
        const missing = rows.filter(r => r.missingDestination);
        if (missing.length)
          throw new ApplicationError("PAYMENT_DESTINATION_REQUIRED", { fieldErrors: Object.fromEntries(missing.map(r => [`employee_${r.employeeId}`, [`${r.employeeCode}: ${r.missingDestination}`]])) });
        const inserts: NewPayment[] = [];
        for (const row of rows) {
          if (row.payment || row.amount === "0.00")
            continue;
          const destination = await d.employee.getPaymentDestinationInTransaction(e, { ...c, employeeId: row.employeeId });
          const bank = destination.paymentMethod === "transfer" ? await d.bank.getPrimaryPaymentSnapshot(e, { ...c, employeeId: row.employeeId }) : null;
          // Reads lock recipient rows through insertion; a later edit cannot change this snapshot.
          if (destination.paymentMethod === "transfer" && ((row.member && !bank) || (!row.member && !destination.promptpayPhone)))
            throw new ApplicationError("PAYMENT_DESTINATION_REQUIRED", { fieldErrors: { [`employee_${row.employeeId}`]: [`${row.employeeCode}: ตรวจสอบปลายทางรับเงินที่หน้าพนักงาน`] } });
          inserts.push({ payrollRecordId: row.recordId, branchIdSnapshot: row.branchId, paymentMethod: destination.paymentMethod, amount: row.amount, preparedByUserAccountId: Number(c.actor.accountId), promptpayPhoneSnapshot: destination.paymentMethod === "transfer" ? destination.promptpayPhone : null, employeeBankAccountId: bank ? Number(bank.id) : null, bankCodeSnapshot: bank?.bankCode ?? null, accountHolderNameSnapshot: bank?.accountHolderName ?? null, accountNumberCiphertextSnapshot: bank?.accountNumberCiphertext ?? null, accountNumberLast4Snapshot: bank?.accountNumberLast4 ?? null });
        }
        await d.repository.insert(e, inserts);
        const receipt = await d.domain.record(e, ctx, { newData: { period_id: c.periodId, branch_id: c.branchId ?? null, prepared_count: inserts.length, payroll_record_ids: inserts.map(r => String(r.payrollRecordId)) } });
        return d.domain.complete(await load(e, c), receipt);
      }));
    },
    async getPromptpayQr(c: {
      actor: AuthenticatedActor;
      requestId: string;
      paymentId: string;
    }) {
      assertPayrollMutationAccess(c.actor);
      return d.actions.observeRead(context(c, "payroll.payment.qr", c.paymentId), async () => {
        const row = await d.repository.find(d.rootExecutor, c.paymentId), p = row?.payment;
        if (!row || !p)
          throw new ApplicationError("RESOURCE_NOT_FOUND");
        if (row.member || p.status !== "prepared" || p.paymentMethod !== "transfer" || !p.promptpayPhoneSnapshot)
          throw new ApplicationError("PAYMENT_QR_UNAVAILABLE");
        return { phone: p.promptpayPhoneSnapshot, amount: p.amount, payload: promptpayPayload(p.promptpayPhoneSnapshot, p.amount) };
      });
    },
  };
};
