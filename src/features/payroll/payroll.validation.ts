import { ApplicationError } from "../../core/errors/application.error";
import {
  payrollConfigurationUnits,
  type PayrollConfigurationKey,
} from "./payroll.types";

const idPattern = /^[1-9]\d*$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const decimalPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/;

export const parsePayrollId = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !idPattern.test(value)) {
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
