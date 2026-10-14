import { test,expect } from "bun:test";
import { summarizePayrollReadiness } from "./payroll.readiness.service";
import type { PayrollReadinessFacts } from "./payroll.readiness.types";
import { periodFixture } from "./payroll.test-support";
const facts=():PayrollReadinessFacts=>({branches:[{id:"2",name:"สาขาทดสอบ"}],departmentBranchIds:["2"],positionCount:1,roster:[{employeeId:"10",employeeCode:"EMP10",employeeName:"พนักงานทดสอบ",branchId:"2",branchName:"สาขาทดสอบ",effectiveFrom:"2026-09-01",effectiveTo:null}],configurations:[],schedules:[],attendance:[],weeklyHolidays:[{employeeId:"10",weekday:0,effectiveFrom:"2026-09-01",effectiveTo:null}],holidays:[],overrides:[],pending:[{kind:"leave",employeeId:"10",startDate:"2026-09-01",endDate:"2026-09-02"}],approvedOvertime:[],bankEmployeeIds:[]});
test("readiness reveals configuration, schedule, attendance, approval and bank gaps together",()=>{
  const result=summarizePayrollReadiness(facts(),periodFixture());
  expect(result.checks.filter(row=>row.status!=="ready").map(row=>row.key)).toEqual(["schedule","configuration","attendance","approvals","bank"]);
  expect(result.checks.find(row=>row.key==="attendance")!.issues[0]!.dates).toHaveLength(26);
  expect(result.canLock).toBe(false);expect(result.canExport).toBe(false);
});
test("bank data is needed for exports, not for locking a complete payroll",()=>{
  const value=facts();value.pending=[];value.schedules=[{branchId:"2",effectiveFrom:"2026-09-01",effectiveTo:null}];
  value.attendance=Array.from({length:30},(_,index)=>({employeeId:"10",date:`2026-09-${String(index+1).padStart(2,"0")}`}));
  value.configurations=["STANDARD_WORK_DAYS","ABSENCE_RATE","LATE_RATE","SOCIAL_SECURITY_RATE","SOCIAL_SECURITY_CAP"].map((key,index)=>({id:String(index+1),shopId:"1",branchId:null,configKey:key as "STANDARD_WORK_DAYS",numericValue:"1",unit:"days",effectiveFrom:"2026-09-01",effectiveTo:null,createdByUserAccountId:"1"}));
  expect(summarizePayrollReadiness(value,periodFixture()).canLock).toBe(true);
  const locked=summarizePayrollReadiness(value,periodFixture("locked"));expect(locked.canLock).toBe(false);expect(locked.canExport).toBe(false);
  value.bankEmployeeIds=["10"];expect(summarizePayrollReadiness(value,periodFixture("locked")).canExport).toBe(true);
});

test("employment gaps are shown but dates outside employment are not gaps",()=>{
  const value=facts();const assignment=value.roster[0]!;
  value.roster=[{...assignment,effectiveFrom:"2026-09-05",effectiveTo:"2026-09-10"},{...assignment,effectiveFrom:"2026-09-12",effectiveTo:"2026-09-25"}];
  const employment=summarizePayrollReadiness(value,periodFixture()).checks.find(row=>row.key==="employment")!;
  expect(employment.status).toBe("invalid");expect(employment.issues[0]!.dates).toEqual(["2026-09-11"]);
});
