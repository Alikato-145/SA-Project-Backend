import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { DatabaseExecutor } from "../../core/db/transaction";
import type { ActionObserver } from "../../core/audit/action-observer";
import { createActionContext } from "../../core/audit/action-context";
import { assertPayrollMutationAccess } from "../payroll/payroll.authorization";
import type { BankAccountCipher } from "../employee-bank-account/employee-bank-account.crypto";
import { reportRepository } from "./report.repository";
import type { ReportFilters,ReportKind } from "./report.types";
import { ApplicationError } from "../../core/errors/application.error";
import { parsePayrollId } from "../payroll/payroll.validation";
import { csv } from "./report.csv";

const authorize = (actor: AuthenticatedActor) => assertPayrollMutationAccess(actor);
export const createReportService = (dependencies: { rootExecutor: DatabaseExecutor; actions: ActionObserver; cipher: BankAccountCipher }) => {
  const readPeriod=async(actor:AuthenticatedActor,periodId:string,filters:ReportFilters={})=>{
    authorize(actor);parsePayrollId(periodId,"period_id");
    const period=await reportRepository.findPeriod(dependencies.rootExecutor,periodId);
    if(!period)throw new ApplicationError("PAYROLL_PERIOD_NOT_FOUND");
    if(filters.branchId)parsePayrollId(filters.branchId,"branch_id");
    if(filters.departmentId)parsePayrollId(filters.departmentId,"department_id");
    const department=filters.departmentId ? await reportRepository.findDepartment(dependencies.rootExecutor,filters.departmentId):undefined;
    if(filters.departmentId && !department)throw new ApplicationError("RESOURCE_NOT_FOUND");
    if(department && filters.branchId && department.branchId!==Number(filters.branchId))throw new ApplicationError("INVALID_ORGANIZATION_RELATION");
    const branchId=filters.branchId ?? (department ? String(department.branchId):undefined);
    if(branchId) {
      const branch=await reportRepository.findBranch(dependencies.rootExecutor,branchId);
      if(!branch || branch.shopId!==period.shopId)throw new ApplicationError("INVALID_ORGANIZATION_RELATION");
    }
    return {period,filters:{...filters,branchId}};
  };
  const readSummary=async(actor:AuthenticatedActor,periodId:string,requestId:string,filters:ReportFilters={},action="read")=>{
    const context=createActionContext({actor,requestId,actionBase:`report.summary.${action}`,target:{tableName:"payroll_periods",recordId:periodId}});
    return dependencies.actions.observeRead(context,async()=>{
      const loaded=await readPeriod(actor,periodId,filters);
      return reportRepository.summary(dependencies.rootExecutor,loaded.period,loaded.filters);
    });
  };
  return {
  summary:(actor:AuthenticatedActor,periodId:string,requestId:string,filters:ReportFilters={})=>readSummary(actor,periodId,requestId,filters),
  summaryExport:(actor:AuthenticatedActor,periodId:string,requestId:string,filters:ReportFilters={})=>readSummary(actor,periodId,requestId,filters,"export"),
  async details(actor:AuthenticatedActor,periodId:string,kind:ReportKind,requestId:string,filters:ReportFilters={},page=1,pageSize=20) {
    const context=createActionContext({actor,requestId,actionBase:"report.details.read",target:{tableName:"payroll_periods",recordId:periodId}});
    return dependencies.actions.observeRead(context,async()=>{
      if(!["attendance","leave","overtime","debt","payroll"].includes(kind)||!Number.isInteger(page)||page<1||!Number.isInteger(pageSize)||pageSize<1||pageSize>100)throw new ApplicationError("VALIDATION_ERROR");
      const loaded=await readPeriod(actor,periodId,filters);
      // ponytail: page a restaurant-sized read projection; push slicing to SQL if datasets grow large.
      const rows=await reportRepository.details(dependencies.rootExecutor,loaded.period,kind,loaded.filters);
      return {rows:rows.slice((page-1)*pageSize,page*pageSize),total:rows.length,page,pageSize};
    });
  },
  async bankTransfer(actor: AuthenticatedActor, periodId: string, requestId: string) {
    const context = createActionContext({ actor, requestId, actionBase: "report.bank-transfer.export", target: { tableName: "payroll_records", recordId: periodId } });
    return dependencies.actions.observeRead(context, async () => {
      authorize(actor);
      parsePayrollId(periodId,"period_id");
      const period=await reportRepository.findPeriod(dependencies.rootExecutor,periodId);
      if(!period)throw new ApplicationError("PAYROLL_PERIOD_NOT_FOUND");
      if(period.status!=="locked")throw new ApplicationError("STATE_CONFLICT",{publicMessage:"ต้องล็อกรอบเงินเดือนก่อนส่งออก"});
      const rows = await reportRepository.lockedRows(dependencies.rootExecutor, periodId);
      if(rows.some(row=>!row.accountCiphertext||!row.bankCode||!row.accountHolder))throw new ApplicationError("VALIDATION_ERROR",{publicMessage:"มีพนักงานที่ไม่มีบัญชีธนาคารหลักครบถ้วน ให้แก้ข้อมูลก่อนส่งออกเพื่อไม่ให้ตกหล่น"});
      const body = await Promise.all(rows.map(async (row) => [row.bankCode!, await dependencies.cipher.decrypt(row.accountCiphertext!), row.accountHolder!, row.netPay]));
      return csv([["bank_code", "account_number", "account_holder", "net_pay"], ...body]);
    });
  },
  async socialSecurity(actor: AuthenticatedActor, periodId: string, requestId: string) {
    const context = createActionContext({ actor, requestId, actionBase: "report.social-security.export", target: { tableName: "payroll_records", recordId: periodId } });
    return dependencies.actions.observeRead(context, async () => {
      authorize(actor);
      parsePayrollId(periodId,"period_id");
      const period=await reportRepository.findPeriod(dependencies.rootExecutor,periodId);
      if(!period)throw new ApplicationError("PAYROLL_PERIOD_NOT_FOUND");
      if(period.status!=="locked")throw new ApplicationError("STATE_CONFLICT",{publicMessage:"ต้องล็อกรอบเงินเดือนก่อนส่งออก"});
      const rows = await reportRepository.lockedRows(dependencies.rootExecutor, periodId);
      return csv([["employee_code", "employee_name", "base_salary", "social_security_deduction"], ...rows.map((row) => [row.employeeCode, `${row.employeeName} ${row.employeeLastName}`, row.baseSalary,row.socialSecurityDeduction])]);
    });
  },
};
};
export type ReportService = ReturnType<typeof createReportService>;
