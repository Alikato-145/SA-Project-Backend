import { ApplicationError } from "../../core/errors/application.error";

export interface EmployeePaymentDestination {
  paymentMethod: "cash" | "transfer";
  promptpayPhone: string | null;
}

export const normalizePromptpayPhone = (value: string | null): string | null => {
  if (value === null) return null;
  const compact = value.replace(/[\s()\-]/g, "");
  const canonical = compact.startsWith("+66") ? `0${compact.slice(3)}` : compact;
  if (!/^0[689][0-9]{8}$/.test(canonical)) throw new ApplicationError("VALIDATION_ERROR", { fieldErrors: { promptpay_phone: ["ระบุหมายเลขโทรศัพท์มือถือไทยที่ถูกต้อง"] } });
  return canonical;
};
