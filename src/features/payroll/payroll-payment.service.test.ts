import { expect, test } from "bun:test";
import { createPayrollPaymentService } from "./payroll-payment.service";
import { payrollActor } from "./payroll.test-support";
import type { PaymentRecord, Payment } from "./payroll-payment.types";
import type { PayrollPaymentDependencies } from "./payroll-payment.service";
const fixture = () => {
  const records: PaymentRecord[] = [true, false, false, false].map((member, i) => ({ recordId: i + 1, employeeId: String(i + 1), employeeCode: `E${i + 1}`, employeeName: `Employee ${i + 1}`, branchId: 2, branchName: "A", member, amount: i === 3 ? "0.00" : "100.01", payment: null }));
  let phone: string | null = "0812345678";
  let method: "cash" | "transfer" = "transfer";
  const categories: Record<string, "cash" | "transfer" | "social_security"> = {};
  const inserted: Payment[] = [];
  const d = { rootExecutor: {}, transactionRunner: { transaction: async (work: Function) => work({ execute: async () => { } }) }, repository: { period: async () => ({ status: "locked" }), records: async () => records, insert: async (_: unknown, rows: unknown[]) => { for (const row of rows)
        inserted.push({ ...row as object, id: inserted.length + 1, status: "prepared" } as Payment); records.forEach(r => r.payment = inserted.find(p => p.payrollRecordId === r.recordId) ?? null); }, find: async () => records[2] }, employee: { getPaymentDestinationInTransaction: async (_: unknown, c: {
        employeeId: string;
      }) => ({ paymentMethod: c.employeeId === "2" ? "cash" : method, promptpayPhone: phone, paymentCategory: categories[c.employeeId] }) }, bank: { getPrimaryPaymentSnapshot: async () => ({ id: "1", bankCode: "004", accountHolderName: "Holder", accountNumberCiphertext: "cipher", accountNumberLast4: "1234" }) }, actions: { observeRead: async (_: unknown, work: Function) => work(), observeMutation: async (_: unknown, work: Function) => work() }, domain: { record: async () => ({}), complete: (v: unknown) => v } } as unknown as PayrollPaymentDependencies;
  const service = createPayrollPaymentService(d);
  const command = { actor: payrollActor(), requestId: "test", periodId: "1" };
  return { service, command, records, inserted, categories, setPhone: (v: string | null) => phone = v, setMethod: (v: "cash" | "transfer") => method = v };
};
test("exclusive member/cash/transfer partition includes zero separately", async () => { const h = fixture(); const rows = await h.service.listPaymentGroups(h.command); expect(rows.map(r => r.group)).toEqual(["social_security", "cash", "transfer", "transfer"]); expect(rows.filter(r => r.amount === "0.00")).toHaveLength(1); });
test("selected category overrides membership and remains frozen after preparation", async () => {
  const h = fixture(); h.categories["1"] = "transfer"; h.categories["3"] = "social_security";
  expect((await h.service.listPaymentGroups(h.command)).map(r => r.group)).toEqual(["transfer", "cash", "social_security", "transfer"]);
  await h.service.preparePayrollPayments(h.command);
  h.categories["1"] = "social_security"; h.categories["3"] = "transfer";
  expect((await h.service.listPaymentGroups(h.command)).map(r => r.group)).toEqual(["transfer", "cash", "social_security", "transfer"]);
});
test("finance access denies manager for reads prepare and QR", async () => { const h = fixture(), c = { ...h.command, actor: payrollActor("BRANCH_MANAGER") }; await expect(h.service.listPaymentGroups(c)).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" }); await expect(h.service.preparePayrollPayments(c)).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" }); await expect(h.service.getPromptpayQr({ ...c, paymentId: "1" })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" }); });
test("missing new destination validates whole batch before insert", async () => { const h = fixture(); h.setPhone(null); await expect(h.service.preparePayrollPayments(h.command)).rejects.toMatchObject({ code: "PAYMENT_DESTINATION_REQUIRED" }); expect(h.inserted).toHaveLength(0); });
test("repeated prepare keeps frozen destination and full cents and excludes zero", async () => { const h = fixture(); await h.service.preparePayrollPayments(h.command); h.setPhone("0899999999"); h.setMethod("cash"); await h.service.preparePayrollPayments(h.command); expect(h.inserted).toHaveLength(3); const row = h.inserted.find(p => p.payrollRecordId === 3)!; expect(row.promptpayPhoneSnapshot).toBe("0812345678"); expect(row.amount).toBe("100.01"); const qr = await h.service.getPromptpayQr({ ...h.command, paymentId: String(row.id) }); expect(qr.phone).toBe("0812345678"); expect(qr.amount).toBe("100.01"); });
