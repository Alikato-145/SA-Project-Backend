import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { ReportService } from "./report.service";
import { toReportSummaryDto,toReportSummaryCsv,toReportDetailDtos } from "./report.mapper";
import type { ReportFilters,ReportKind } from "./report.types";
export const createReportController=(service:ReportService)=>({
  summary:async(actor:AuthenticatedActor,periodId:string,requestId:string,filters:ReportFilters={})=>({data:toReportSummaryDto(await service.summary(actor,periodId,requestId,filters)),request_id:requestId}),
  details:async(actor:AuthenticatedActor,periodId:string,kind:ReportKind,requestId:string,filters:ReportFilters={},page=1,pageSize=20)=>{
    const result=await service.details(actor,periodId,kind,requestId,filters,page,pageSize);
    return {data:toReportDetailDtos(result),page:result.page,page_size:result.pageSize,total:result.total,request_id:requestId};
  },
  summaryDownload:async(actor:AuthenticatedActor,periodId:string,requestId:string,filters:ReportFilters={})=>new Response(toReportSummaryCsv(await service.summaryExport(actor,periodId,requestId,filters)),{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename=summary-${periodId}.csv`,"cache-control":"private, no-store","x-content-type-options":"nosniff"}}),
  download:async(actor:AuthenticatedActor,kind:"bank-transfer"|"social-security",periodId:string,requestId:string)=>new Response(await (kind==="bank-transfer"?service.bankTransfer:service.socialSecurity)(actor,periodId,requestId),{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename=${kind}-${periodId}.csv`,"cache-control":"private, no-store","x-content-type-options":"nosniff"}}),
});
