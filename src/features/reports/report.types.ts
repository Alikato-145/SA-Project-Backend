export type ReportFilters={branchId?:string;departmentId?:string};
export type ReportKind="attendance"|"leave"|"overtime"|"debt"|"payroll";

export type SalaryPayableRow={recordId:number;employeeId:number;employeeCode:string;employeeName:string;earnings:string;deductions:string;net:string;paid:string;outstanding:string;status:"zero"|"unprepared"|"prepared"|"paid"};
export type SalaryPayableTotals={employeeCount:number;payableCount:number;earnings:string;deductions:string;net:string;paid:string;outstanding:string};
export type SalaryPayable={
 period:{id:number;startDate:string;endDate:string};filters:ReportFilters;
 branches:{branchId:number;branchName:string;rows:SalaryPayableRow[];totals:SalaryPayableTotals}[];
 totals:SalaryPayableTotals;
};
