import {expect,test} from "bun:test";
import {renderPayableReport} from "./report.document";
import type {SalaryPayable} from "./report.types";
export const documentFixture=():SalaryPayable=>{
 const rows=Array.from({length:70},(_,i)=>({recordId:i+1,employeeId:i+1,employeeCode:`TH-${String(i+1).padStart(3,'0')}`,employeeName:`สมชายชื่อยาวสำหรับการตรวจสอบเอกสาร ${i+1} นามสกุลภาษาไทยยาวต่อเนื่องเพื่อทดสอบการตัดบรรทัด`,earnings:"100.01",deductions:"10.00",net:"90.01",paid:i<35?"90.01":"0.00",outstanding:i<35?"0.00":"90.01",status:i<35?"paid" as const:"unprepared" as const}));
 return{period:{id:12,startDate:"2096-10-01",endDate:"2096-10-31"},filters:{branchId:"2",departmentId:"3"},branches:[{branchId:2,branchName:"สาขาทดสอบชื่อยาวสำหรับการตรวจสอบเอกสารและการขึ้นหน้าใหม่",rows,totals:{employeeCount:70,payableCount:70,earnings:"7000.70",deductions:"700.00",net:"6300.70",paid:"3150.35",outstanding:"3150.35"}}],totals:{employeeCount:70,payableCount:70,earnings:"7000.70",deductions:"700.00",net:"6300.70",paid:"3150.35",outstanding:"3150.35"}};
};
test("Thai payable documents produce paginated PDF for long names and repeatable fiscal facts",async()=>{
 for(const kind of["salary","creditor"]as const){const pdf=await renderPayableReport(documentFixture(),kind);if(process.env.REPORT_ARTIFACT_DIR)await Bun.write(`${process.env.REPORT_ARTIFACT_DIR}/long-thai-${kind}.pdf`,pdf);expect(pdf.subarray(0,5).toString()).toBe("%PDF-");expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)!.length).toBeGreaterThan(2);expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)!.length).toBeLessThanOrEqual(12);}
});
