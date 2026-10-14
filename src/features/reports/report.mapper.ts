import type { ReportService } from "./report.service";
import { csv } from "./report.csv";
export const toReportDetailDtos=(value:Awaited<ReturnType<ReportService["details"]>>)=>value.rows.map(row=>({
  id:String(row.id),employee_id:String(row.employeeId),employee_code:row.employeeCode,employee_name:`${row.firstName} ${row.lastName}`,date:row.date,status:row.status,quantity:row.quantity,quantity_unit:"quantityUnit" in row ? row.quantityUnit : null,amount:row.amount,
}));
export const toReportSummaryCsv=(value:Awaited<ReturnType<ReportService["summary"]>>)=>{
  const rows:string[][]=[];
  for(const section of ["attendance","leave","overtime","debt","payroll"] as const) {
    for(const group of value[section]) {
      const row=group as Record<string,unknown>;
      rows.push([section,String(row.status ?? row.kind ?? ""),String(row.count),...(["days","hours","amount","earnings","deductions","net"] as const).map(key=>String(row[key] ?? ""))]);
    }
  }
  return csv([["section","status_or_kind","count","days","hours","amount","earnings","deductions","net"],...rows]);
};
export const toReportSummaryDto=(value:Awaited<ReturnType<ReportService["summary"]>>)=>({
  period:{id:String(value.period.id),period_year:value.period.periodYear,period_month:value.period.periodMonth,start_date:value.period.startDate,end_date:value.period.endDate,status:value.period.status},
  attendance:value.attendance,leave:value.leave,overtime:value.overtime,debt:value.debt,payroll:value.payroll,
});
