import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { ReportService } from "./report.service";
import { toReportSummaryDto,toReportSummaryCsv,toReportDetailDtos } from "./report.mapper";
import type { ReportFilters,ReportKind } from "./report.types";
import {renderPayableReport} from "./report.document";
export const createReportController=(service:ReportService)=>({
  summary:async(actor:AuthenticatedActor,periodId:string,requestId:string,filters:ReportFilters={})=>({data:toReportSummaryDto(await service.summary(actor,periodId,requestId,filters)),request_id:requestId}),
  details:async(actor:AuthenticatedActor,periodId:string,kind:ReportKind,requestId:string,filters:ReportFilters={},page=1,pageSize=20)=>{
    const result=await service.details(actor,periodId,kind,requestId,filters,page,pageSize);
    return {data:toReportDetailDtos(result),page:result.page,page_size:result.pageSize,total:result.total,request_id:requestId};
  },
  summaryDownload:async(actor:AuthenticatedActor,periodId:string,requestId:string,filters:ReportFilters={})=>new Response(toReportSummaryCsv(await service.summaryExport(actor,periodId,requestId,filters)),{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename=summary-${periodId}.csv`,"cache-control":"private, no-store","x-content-type-options":"nosniff"}}),
  periodBankDownload:async(actor:AuthenticatedActor,periodId:string,requestId:string,filters:ReportFilters={})=>new Response(await service.periodBankTransfer(actor,periodId,requestId,filters),{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename=period-bank-transfer-${periodId}.csv`,"cache-control":"private, no-store","x-content-type-options":"nosniff"}}),
  employeeSalaryDownload:async(actor:AuthenticatedActor,periodId:string,requestId:string,filters:ReportFilters={})=>new Response(await service.employeeSalaryExport(actor,periodId,requestId,filters),{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename=employee-salary-${periodId}.csv`,"cache-control":"private, no-store","x-content-type-options":"nosniff"}}),
  payableDownload:async(actor:AuthenticatedActor,kind:"salary"|"creditor",periodId:string,requestId:string,filters:ReportFilters={})=>new Response(new Uint8Array(await renderPayableReport(await service.salaryPayable(actor,periodId,requestId,filters),kind)),{headers:{"content-type":"application/pdf","content-disposition":`attachment; filename=${kind}-summary-${periodId}.pdf`,"cache-control":"private, no-store","x-content-type-options":"nosniff"}}),
  download:async(actor:AuthenticatedActor,kind:"bank-transfer"|"social-security",periodId:string,requestId:string,filters:ReportFilters={})=>new Response(await (kind==="bank-transfer"?service.bankTransfer:service.socialSecurity)(actor,periodId,requestId,filters),{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename=${kind}-${periodId}.csv`,"cache-control":"private, no-store","x-content-type-options":"nosniff"}}),
});
