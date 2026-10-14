import nodemailer from "nodemailer";
import { ApplicationError } from "../errors/application.error";

export type PayslipMailer = { send(input: { recipient: string; attemptId: string; filename: string; bytes: Uint8Array }): Promise<string> };
export const createSmtpMailer = (env: Record<string, string | undefined> = process.env): PayslipMailer => ({
  async send(input) {
    if (!env.SMTP_HOST || !env.SMTP_FROM) throw new ApplicationError("STATE_CONFLICT", { publicMessage: "ยังไม่ได้ตั้งค่า SMTP_HOST และ SMTP_FROM สำหรับส่งสลิป" });
    const port = Number(env.SMTP_PORT ?? 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535 || Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD)) throw new ApplicationError("VALIDATION_ERROR");
    const transport = nodemailer.createTransport({
      host: env.SMTP_HOST, port, secure: env.SMTP_SECURE === "true" || port === 465,
      requireTLS: env.NODE_ENV === "production", connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
      ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } } : {}),
      disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false,
    });
    try {
      const result = await transport.sendMail({ from: env.SMTP_FROM, to: input.recipient,
        subject: "สลิปเงินเดือน Haris Payroll", text: "แนบสลิปจากงวดเงินเดือนที่ล็อกแล้ว เอกสารนี้ไม่ใช่หลักฐานการโอนหรือจ่ายเงิน",
        messageId: `<payslip-attempt-${input.attemptId}@haris-payroll.local>`,
        attachments: [{ filename: input.filename, content: Buffer.from(input.bytes), contentType: "application/pdf" }],
      });
      if (!result.accepted?.length || result.rejected?.length) throw new Error("SMTP did not accept recipient");
      return String(result.messageId);
    } finally { transport.close(); }
  },
});
