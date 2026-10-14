import { ApplicationError } from "../../core/errors/application.error";

export type LeaveTypeCommand = {
  code: string; nameTh: string; quotaType: "fixed" | "by_seniority" | "none";
  quotaDays: string | null; isDeductible: boolean; requiresDocument: boolean;
  allowExceed: boolean; isActive: boolean;
};
export const assertQuotaDays = (value: string) => {
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(value) || Number(value) > 366) {
    throw new ApplicationError("VALIDATION_ERROR", { publicMessage: "จำนวนวันต้องอยู่ระหว่าง 0 ถึง 366 และมีทศนิยมไม่เกิน 2 ตำแหน่ง" });
  }
};
export const assertLeaveTypeCommand = (command: LeaveTypeCommand) => {
  if (!/^[A-Z][A-Z0-9_]{0,29}$/.test(command.code) || !command.nameTh.trim() || command.nameTh.length > 100 || !["fixed", "by_seniority", "none"].includes(command.quotaType)) {
    throw new ApplicationError("VALIDATION_ERROR");
  }
  if (command.quotaType === "fixed") {
    if (command.quotaDays === null) throw new ApplicationError("VALIDATION_ERROR");
    assertQuotaDays(command.quotaDays);
  } else if (command.quotaDays !== null) throw new ApplicationError("VALIDATION_ERROR");
};
