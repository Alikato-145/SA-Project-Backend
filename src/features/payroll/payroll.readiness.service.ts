import type { PayrollReadinessFacts,PayrollReadiness,ReadinessCheck,ReadinessIssue } from "./payroll.readiness.types";
import type { PayrollPeriodRecord } from "./payroll.types";
import { payrollInclusiveDates } from "./payroll.repository";

export const summarizePayrollReadiness=(facts:PayrollReadinessFacts,period:PayrollPeriodRecord):PayrollReadiness=>{
  const dates=payrollInclusiveDates(period.startDate,period.endDate);
  const checks:ReadinessCheck[]=[];
  const check=(key:string,label:string,issues:ReadinessIssue[],configured:boolean,requiredForLock=true,requiredForExport=false,pending=false)=>checks.push({key,label,issues,requiredForLock,requiredForExport,status:issues.length ? pending ? "pending" : configured ? "invalid" : "not_configured" : "ready"});
  const organization:ReadinessIssue[]=[];
  if(!facts.branches.length)organization.push({message:"ยังไม่มีสาขาในขอบเขตนี้",href:"/organization"});
  for(const branch of facts.branches)if(!facts.departmentBranchIds.includes(branch.id))organization.push({branchId:branch.id,message:`${branch.name} ยังไม่มีแผนก`,href:"/organization"});
  if(!facts.positionCount)organization.push({message:"ยังไม่มีตำแหน่งในร้านนี้",href:"/organization"});
  check("organization","ร้าน สาขา แผนก และตำแหน่ง",organization,Boolean(facts.branches.length),false);
  const employeeIds=[...new Set(facts.roster.map(row=>row.employeeId))];
  check("employment","ประวัติการจ้างในงวด",employeeIds.length ? [] : [{message:"ไม่มีพนักงานที่มีประวัติการจ้างในช่วงงวดนี้ การผูกบัญชีกับสาขาเพียงอย่างเดียวไม่เพิ่มรายชื่อ",href:"/employees"}],employeeIds.length>0);
  const employmentCheck=checks.find(row=>row.key==="employment")!;
  for(const employeeId of employeeIds) {
    const assignments=facts.roster.filter(row=>row.employeeId===employeeId);
    const first=assignments.reduce((date,row)=>row.effectiveFrom<date?row.effectiveFrom:date,period.endDate);
    const last=assignments.reduce((date,row)=>(row.effectiveTo??period.endDate)>date?(row.effectiveTo??period.endDate):date,period.startDate);
    const gaps=dates.filter(date=>date>=first&&date<=last&&!assignments.some(row=>row.effectiveFrom<=date&&(row.effectiveTo===null||row.effectiveTo>=date)));
    if(gaps.length)employmentCheck.issues.push({employeeId,message:`${assignments[0]!.employeeName}: ประวัติการจ้างมีช่วงว่าง ${gaps.length} วัน`,dates:gaps,href:`/employees/${employeeId}/employment`});
  }
  if(employeeIds.length&&employmentCheck.issues.length)employmentCheck.status="invalid";
  const scheduleIssues:ReadinessIssue[]=[],configIssues:ReadinessIssue[]=[],attendanceIssues:ReadinessIssue[]=[];
  const configurationExists=(branchId:string,key:string,date:string)=>facts.configurations.some(row=>row.configKey===key&&(row.branchId===null||row.branchId===branchId)&&row.effectiveFrom<=date&&(row.effectiveTo===null||row.effectiveTo>=date));
  for(const employeeId of employeeIds) {
    const assignments=facts.roster.filter(row=>row.employeeId===employeeId);
    const missingSchedule:string[]=[],missingAttendance:string[]=[];
    const missingConfigs=new Map<string,string[]>();
    for(const date of dates) {
      const assignment=assignments.find(row=>row.effectiveFrom<=date&&(row.effectiveTo===null||row.effectiveTo>=date));
      if(!assignment)continue;
      const schedule=facts.schedules.some(row=>row.branchId===assignment.branchId&&row.effectiveFrom<=date&&(row.effectiveTo===null||row.effectiveTo>=date));
      if(!schedule)missingSchedule.push(date);
      for(const key of ["ABSENCE_RATE","LATE_RATE","SOCIAL_SECURITY_RATE","SOCIAL_SECURITY_CAP"])if(!configurationExists(assignment.branchId,key,date))missingConfigs.set(key,[...(missingConfigs.get(key)??[]),date]);
      const weekday=new Date(`${date}T00:00:00Z`).getUTCDay();
      const weekly=facts.weeklyHolidays.some(row=>row.employeeId===employeeId&&row.weekday===weekday&&row.effectiveFrom<=date&&(row.effectiveTo===null||row.effectiveTo>=date));
      const closed=facts.overrides.some(row=>row.branchId===assignment.branchId&&row.date===date&&row.isClosed);
      if(!weekly&&!closed&&!facts.holidays.includes(date)&&!facts.attendance.some(row=>row.employeeId===employeeId&&row.date===date))missingAttendance.push(date);
    }
    for(const overtime of facts.approvedOvertime.filter(row=>row.employeeId===employeeId)) {
      const assignment=assignments.find(row=>row.effectiveFrom<=overtime.date&&(row.effectiveTo===null||row.effectiveTo>=overtime.date));
      const key=overtime.type==="hourly"?"OT_HOURLY_RATE":overtime.type==="rest_day"?"OT_REST_DAY_RATE":"OT_PUBLIC_HOLIDAY_RATE";
      if(assignment&&!configurationExists(assignment.branchId,key,overtime.date))missingConfigs.set(key,[...(missingConfigs.get(key)??[]),overtime.date]);
    }
    const employee=assignments[0]!;
    if(missingSchedule.length)scheduleIssues.push({employeeId,message:`${employee.employeeName}: ตารางสาขาไม่ครอบคลุม ${missingSchedule.length} วัน`,dates:missingSchedule,href:"/schedules"});
    for(const [key,missing] of missingConfigs)configIssues.push({employeeId,configKeys:[key],dates:missing,message:`${employee.employeeName}: ยังขาด ${key} ที่มีผลตั้งแต่ ${missing[0]}`,href:"#configuration-readiness"});
    if(missingAttendance.length)attendanceIssues.push({employeeId,dates:missingAttendance,message:`${employee.employeeName}: ไม่มีข้อมูลลงเวลา ${missingAttendance.length} วัน`,href:"/attendance"});
  }
  check("schedule","ตารางสาขาและช่วงวันที่",scheduleIssues,facts.schedules.length>0);
  check("configuration","ค่าคำนวณที่มีผลในงวด",configIssues,facts.configurations.length>0);
  check("attendance","ข้อมูลลงเวลาครบทุกวันทำงาน",attendanceIssues,facts.attendance.length>0);
  const pending=facts.pending.filter(row=>row.employeeId===null||facts.roster.some(assignment=>assignment.employeeId===row.employeeId&&assignment.effectiveFrom<=row.endDate&&(assignment.effectiveTo===null||assignment.effectiveTo>=row.startDate)));
  check("approvals","คำขอลา OT เงินทดรอง และรายการปรับปรุง",pending.map(row=>({...(row.employeeId?{employeeId:row.employeeId}:{}),message:`${row.employeeId ? `${facts.roster.find(assignment => assignment.employeeId === row.employeeId)?.employeeName ?? `พนักงาน ${row.employeeId}`}: ` : ""}มี ${{leave:"คำขอลา",overtime:"OT",advance:"เงินทดรอง",adjustment:"รายการปรับปรุง"}[row.kind as "leave"] ?? row.kind} รอพิจารณาในช่วง ${row.startDate} ถึง ${row.endDate}`,href:row.kind==="leave"?"/leave":row.kind==="overtime"?"/overtime":row.kind==="adjustment"?"/payroll":"/finance"})),true,true,false,true);
  const bankIssues=employeeIds.filter(id=>!facts.bankEmployeeIds.includes(id)).map(employeeId=>({employeeId,message:`${facts.roster.find(row=>row.employeeId===employeeId)!.employeeName}: ยังไม่มีบัญชีธนาคารหลักครบถ้วน`,href:`/employees/${employeeId}/bank`}));
  check("bank","บัญชีธนาคารสำหรับ CSV โอนเงิน",bankIssues,facts.bankEmployeeIds.length>0,false,true);
  return {checks,employeeCount:employeeIds.length,canLock:period.status!=="locked"&&checks.every(row=>!row.requiredForLock||row.status==="ready"),canExport:period.status==="locked"&&checks.every(row=>!row.requiredForExport||row.status==="ready")};
};
