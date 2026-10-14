import { ApplicationError } from "../../core/errors/application.error";
import { parseFixed } from "./calculation/decimal";
import {
  payrollConfigurationUnits,
  type PayrollConfigurationKey,
} from "./payroll.types";

const idPattern = /^[1-9]\d*$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const decimalPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/;

export const parsePayrollId = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !idPattern.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new ApplicationError("VALIDATION_ERROR", { fieldErrors: { [field]: ["Must be a positive decimal identifier."] } });
  }
  return value;
};

export const parsePayrollDate = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !datePattern.test(value)) {
    throw new ApplicationError("VALIDATION_ERROR", { fieldErrors: { [field]: ["Must be an ISO date."] } });
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new ApplicationError("VALIDATION_ERROR", { fieldErrors: { [field]: ["Must be a valid ISO date."] } });
  }
  return value;
};

export const parsePayrollDecimal = (value: unknown, field: string, positive = false): string => {
  if (typeof value !== "string" || !decimalPattern.test(value) || (positive && /^0(?:\.0+)?$/.test(value))) {
    throw new ApplicationError("VALIDATION_ERROR", { fieldErrors: { [field]: [positive ? "Must be positive." : "Must be non-negative."] } });
  }
  return value;
};
export const parsePayrollMoney = (value: unknown, field: string, positive = false): string => {
  const parsed = parsePayrollDecimal(value, field, positive);
  try {
    if (parsed.split(".")[0]!.length > 10) throw new RangeError("Money overflow");
    parseFixed(parsed, 2);
  } catch {
    throw new ApplicationError("VALIDATION_ERROR", { fieldErrors: { [field]: ["จำนวนเงินต้องไม่เกิน 10 หลักก่อนจุดทศนิยม และมีทศนิยมไม่เกิน 2 ตำแหน่ง"] } });
  }
  return parsed;
};

export const parsePayrollConfigurationKey = (key: unknown, unit: unknown): PayrollConfigurationKey => {
  if (typeof key !== "string" || !(key in payrollConfigurationUnits) ||
      typeof unit !== "string" || payrollConfigurationUnits[key as PayrollConfigurationKey] !== unit) {
    throw new ApplicationError("VALIDATION_ERROR", { fieldErrors: { config_key: ["Unsupported payroll configuration key or unit."] } });
  }
  return key as PayrollConfigurationKey;
};

export const assertPayrollRange = (start: string, end: string | null) => {
  parsePayrollDate(start, "effective_from");
  if (end !== null && parsePayrollDate(end, "effective_to") < start) {
    throw new ApplicationError("VALIDATION_ERROR", { fieldErrors: { effective_to: ["Must not precede effective_from."] } });
  }
};
export const assertPayrollMonthRange=(year:number,month:number,start:string,end:string)=>{
  if(!Number.isInteger(year)||year<2000||year>2200||!Number.isInteger(month)||month<1||month>12)throw new ApplicationError("VALIDATION_ERROR");
  const first=`${year}-${String(month).padStart(2,"0")}-01`;
  const last=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);
  if(start!==first||end!==last)throw new ApplicationError("VALIDATION_ERROR",{publicMessage:"ช่วงรอบเงินเดือนต้องตรงกับวันแรกและวันสุดท้ายของเดือนที่เลือก"});
};

export const assertPayrollConfigurationValue = (key: PayrollConfigurationKey, value: string) => {
  parsePayrollDecimal(value, "numeric_value");
  if (value.split(".")[0]!.length > 10) throw new ApplicationError("VALIDATION_ERROR");
  if (key === "SOCIAL_SECURITY_CAP") parsePayrollMoney(value, "numeric_value");
  const scaled = parseFixed(value, 4);
  if ((key === "STANDARD_WORK_DAYS" && (scaled < 100n || scaled > 310000n || scaled % 100n !== 0n)) ||
    (key === "SOCIAL_SECURITY_RATE" && scaled > 10000n)) {
    throw new ApplicationError("VALIDATION_ERROR", { fieldErrors: { numeric_value: [
      key === "STANDARD_WORK_DAYS" ? "จำนวนวันมาตรฐานต้องอยู่ระหว่าง 0.01 ถึง 31 และมีทศนิยมไม่เกิน 2 ตำแหน่ง" :
      "อัตราประกันสังคมใช้สัดส่วนตั้งแต่ 0 ถึง 1 เช่น 0.0500 = 5%",
    ] } });
  }
};
