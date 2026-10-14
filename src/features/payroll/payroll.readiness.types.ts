import type { PayrollConfigurationRecord,PayrollRosterEntry } from "./payroll.types";
export type PayrollReadinessFacts={
  branches:{id:string;name:string}[];departmentBranchIds:string[];positionCount:number;
  roster:PayrollRosterEntry[];configurations:PayrollConfigurationRecord[];
  schedules:{branchId:string;effectiveFrom:string;effectiveTo:string|null}[];
  attendance:{employeeId:string;date:string}[];
  weeklyHolidays:{employeeId:string;weekday:number;effectiveFrom:string;effectiveTo:string|null}[];
  holidays:string[];overrides:{branchId:string;date:string;isClosed:boolean}[];
  pending:{kind:string;employeeId:string|null;startDate:string;endDate:string}[];
  approvedOvertime:{employeeId:string;date:string;type:string}[];bankEmployeeIds:string[];
};
export type ReadinessIssue={message:string;employeeId?:string;branchId?:string;dates?:string[];configKeys?:string[];href:string};
export type ReadinessCheck={key:string;label:string;status:"not_configured"|"invalid"|"pending"|"ready";requiredForLock:boolean;requiredForExport:boolean;issues:ReadinessIssue[]};
export type PayrollReadiness={checks:ReadinessCheck[];canLock:boolean;canExport:boolean;employeeCount:number};
