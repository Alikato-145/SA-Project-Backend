import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { DatabaseExecutor } from "../../core/db/transaction";
import type { ActionObserver } from "../../core/audit/action-observer";
import { createActionContext } from "../../core/audit/action-context";
import { assertPayrollMutationAccess } from "../payroll/payroll.authorization";
import type { BankAccountCipher } from "../employee-bank-account/employee-bank-account.crypto";
import { reportRepository } from "./report.repository";
import type { ReportFilters,ReportKind,SalaryPayable,SalaryPayableRow } from "./report.types";
import { ApplicationError } from "../../core/errors/application.error";
import { parsePayrollId } from "../payroll/payroll.validation";
import { money,formatMoney } from "../payroll/calculation/decimal";
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
  const readLockedPeriod=async(actor:AuthenticatedActor,periodId:string,filters:ReportFilters)=>{
    const loaded=await readPeriod(actor,periodId,filters);
    if(loaded.period.status!=="locked")throw new ApplicationError("STATE_CONFLICT",{publicMessage:"ต้องล็อกรอบเงินเดือนก่อนส่งออก"});
    return loaded;
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
  async employeeSalaryExport(actor:AuthenticatedActor,periodId:string,requestId:string,filters:ReportFilters={}) {
    const context=createActionContext({actor,requestId,actionBase:"report.employee-salary.export",target:{tableName:"payroll_periods",recordId:periodId}});
    return dependencies.actions.observeRead(context,async()=>{
      const loaded=await readPeriod(actor,periodId,filters);
      const rows=await reportRepository.details(dependencies.rootExecutor,loaded.period,"payroll",loaded.filters);
      return csv([["employee_code","employee_name","net_pay"],...rows.map(row=>[row.employeeCode,`${row.firstName} ${row.lastName}`,row.amount ?? "0.00"])]);
    });
  },
  async salaryPayable(actor:AuthenticatedActor,periodId:string,requestId:string,filters:ReportFilters={}):Promise<SalaryPayable> {
    const context=createActionContext({actor,requestId,actionBase:"report.salary-payable.read",target:{tableName:"payroll_periods",recordId:periodId}});
    return dependencies.actions.observeRead(context,async()=>{
      const loaded=await readLockedPeriod(actor,periodId,filters);
      const rows=await reportRepository.lockedRows(dependencies.rootExecutor,periodId,loaded.filters);
      const safeRows:SalaryPayableRow[]=rows.map(row=>({recordId:row.recordId,employeeId:row.employeeId,employeeCode:row.employeeCode,employeeName:`${row.employeeName} ${row.employeeLastName}`,earnings:row.totalEarnings,deductions:row.totalDeductions,net:row.netPay,paid:row.paymentStatus==="paid"?row.netPay:"0.00",outstanding:row.paymentStatus==="paid"?"0.00":row.netPay,status:money(row.netPay)===0n?"zero":row.paymentStatus==="paid"?"paid":row.paymentStatus==="prepared"?"prepared":"unprepared"}));
      const totals=(values:SalaryPayableRow[]):SalaryPayable["totals"]=>{
        const sum=(key:"earnings"|"deductions"|"net"|"paid"|"outstanding")=>formatMoney(values.reduce((total,row)=>total+money(row[key]),0n));
        return {employeeCount:values.length,payableCount:values.filter(r=>money(r.net)>0n).length,earnings:sum("earnings"),deductions:sum("deductions"),net:sum("net"),paid:sum("paid"),outstanding:sum("outstanding")};
      };
      const branchIds=[...new Set(rows.map(row=>row.branchId))];
      return {period:{id:loaded.period.id,startDate:loaded.period.startDate,endDate:loaded.period.endDate},filters:loaded.filters,branches:branchIds.map(branchId=>{const selected=safeRows.filter((_,index)=>rows[index]!.branchId===branchId);return{branchId,branchName:rows.find(row=>row.branchId===branchId)!.branchName,rows:selected,totals:totals(selected)};}),totals:totals(safeRows)};
    });
  },
  async periodBankTransfer(actor:AuthenticatedActor,periodId:string,requestId:string,filters:ReportFilters={}) {
    const context=createActionContext({actor,requestId,actionBase:"report.period-bank-transfer.export",target:{tableName:"payroll_periods",recordId:periodId}});
    return dependencies.actions.observeRead(context,async()=>{
      const loaded=await readLockedPeriod(actor,periodId,filters);
      const rows=(await reportRepository.lockedRows(dependencies.rootExecutor,periodId,loaded.filters)).filter(row=>money(row.netPay)>0n);
      const accounts=await Promise.all(rows.map(row=>reportRepository.findPrimaryBank(dependencies.rootExecutor,row.employeeId)));
      const missing=rows.filter((_,index)=>!accounts[index]);
      if(missing.length)throw new ApplicationError("VALIDATION_ERROR",{publicMessage:`ยังไม่มีบัญชีธนาคารหลัก: ${missing.map(row=>row.employeeCode).join(", ")}`});
      const body=await Promise.all(rows.map(async(row,index)=>{const bank=accounts[index]!;return [bank.bankCode,await dependencies.cipher.decrypt(bank.accountCiphertext),bank.accountHolder,row.netPay];}));
      return csv([["bank_code","account_number","account_holder","net_pay"],...body]);
    });
  },
  async bankTransfer(actor:AuthenticatedActor,periodId:string,requestId:string,filters:ReportFilters={}) {
    const context=createActionContext({actor,requestId,actionBase:"report.bank-transfer.export",target:{tableName:"payroll_periods",recordId:periodId}});
    return dependencies.actions.observeRead(context,async()=>{
      const loaded=await readLockedPeriod(actor,periodId,filters);
      const rows=await reportRepository.lockedRows(dependencies.rootExecutor,periodId,loaded.filters);
      const outstanding=rows.filter(row=>money(row.netPay)>0n && row.paymentStatus!=="paid");
      const unprepared=outstanding.filter(row=>!row.paymentStatus);
      if(unprepared.length)throw new ApplicationError("VALIDATION_ERROR",{publicMessage:`ยังไม่ได้เตรียมจ่าย: ${unprepared.map(r=>r.employeeCode).join(", ")} ให้เตรียมจ่ายเงินเดือนในหน้าเงินเดือนก่อนส่งออก`});
      const transfers=outstanding.filter(row=>row.paymentMethod==="transfer");
      const missing=transfers.filter(row=>!row.accountCiphertext||!row.bankCode||!row.accountHolder);
      if(missing.length)throw new ApplicationError("VALIDATION_ERROR",{publicMessage:`ปลายทางที่เตรียมไว้มีเฉพาะโทรศัพท์ ไม่มีบัญชีธนาคาร: ${missing.map(r=>r.employeeCode).join(", ")} ใช้ QR ในหน้าเงินเดือน หรือยกเลิกการเตรียมจ่ายแล้วเพิ่มบัญชีและเตรียมใหม่ก่อนส่งออก CSV`});
      const body=await Promise.all(transfers.map(async row=>[row.bankCode!,await dependencies.cipher.decrypt(row.accountCiphertext!),row.accountHolder!,row.netPay]));
      return csv([["bank_code","account_number","account_holder","net_pay"],...body]);
    });
  },
  async socialSecurity(actor:AuthenticatedActor,periodId:string,requestId:string,filters:ReportFilters={}) {
    const context=createActionContext({actor,requestId,actionBase:"report.social-security.export",target:{tableName:"payroll_periods",recordId:periodId}});
    return dependencies.actions.observeRead(context,async()=>{
      const loaded=await readLockedPeriod(actor,periodId,filters);
      const rows=await reportRepository.lockedRows(dependencies.rootExecutor,periodId,loaded.filters);
      return csv([["employee_code","employee_name","base_salary","social_security_deduction"],...rows.filter(row=>money(row.baseSalary)>0n||money(row.socialSecurityDeduction)>0n).map(row=>[row.employeeCode,`${row.employeeName} ${row.employeeLastName}`,row.baseSalary,row.socialSecurityDeduction])]);
    });
  },
};
};
export type ReportService=ReturnType<typeof createReportService>;
