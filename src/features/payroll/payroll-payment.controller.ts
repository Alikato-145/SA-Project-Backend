import QRCode from "qrcode";
import type { createPayrollPaymentService } from "./payroll-payment.service";
import { toPayrollPaymentResponseDto } from "./payroll-payment.mapper";
import type { PaymentCommand } from "./payroll-payment.types";
import { parsePayrollId } from "./payroll.validation";
export type PayrollPaymentService = ReturnType<typeof createPayrollPaymentService>;
const parse = (c: PaymentCommand) => ({ ...c, periodId: parsePayrollId(c.periodId, "period_id"), branchId: c.branchId ? parsePayrollId(c.branchId, "branch_id") : undefined });
export const createPayrollPaymentController = (service: PayrollPaymentService) => ({
  async list(c: PaymentCommand) { return { data: (await service.listPaymentGroups(parse(c))).map(toPayrollPaymentResponseDto), request_id: c.requestId }; },
  async prepare(c: PaymentCommand) { return { data: (await service.preparePayrollPayments(parse(c))).map(toPayrollPaymentResponseDto), request_id: c.requestId }; },
  async qr(c: Parameters<PayrollPaymentService["getPromptpayQr"]>[0]) { const qr = await service.getPromptpayQr({ ...c, paymentId: parsePayrollId(c.paymentId, "payment_id") }); return new Response(await QRCode.toString(qr.payload, { type: "svg", margin: 4, errorCorrectionLevel: "M" }), { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } }); },
});
