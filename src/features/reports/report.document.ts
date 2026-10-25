import PDFDocument from "pdfkit";
import {fileURLToPath} from "node:url";
import type {SalaryPayable,SalaryPayableRow,SalaryPayableTotals} from "./report.types";

const statuses:Record<SalaryPayableRow["status"],string>={zero:"สุทธิศูนย์",unprepared:"ยังไม่เตรียม",prepared:"เตรียมแล้ว",paid:"จ่ายแล้ว"};
export const renderPayableReport=(input:SalaryPayable,kind:"salary"|"creditor"):Promise<Buffer>=>new Promise((resolve,reject)=>{
 const doc=new PDFDocument({size:"A4",layout:"landscape",margin:32,bufferPages:true,info:{Title:kind==="salary"?"Salary summary":"Salary payable creditor summary",Author:"Haris Payroll",CreationDate:new Date("2026-01-01T00:00:00Z")}});
 const chunks:Buffer[]=[];doc.on("data",c=>chunks.push(c));doc.on("end",()=>resolve(Buffer.concat(chunks)));doc.on("error",reject);
 doc.font(fileURLToPath(new URL("../payslip/assets/NotoSansThai.ttf",import.meta.url)));
 const creditor=kind==="creditor",widths=creditor?[68,210,88,82,88,88,88,66]:[90,310,126,126,126];
 const labels=creditor?["รหัส","พนักงาน","รายได้","รายการหัก","สุทธิ","จ่ายแล้ว","ค้างจ่าย","สถานะ"]:["รหัส","พนักงาน","รายได้รวม","รายการหักรวม","สุทธิ"];
 let y=32;
 const text=(value:string,x:number,top:number,width:number,align:"left"|"right"="left",size=9)=>doc.fontSize(size).fillColor("#172421").text(value,x,top,{width,align,lineGap:2});
 const pageHeader=(branch:string)=>{
  text("Haris Payroll",32,26,778,"left",16);
  text(creditor?"สรุปเจ้าหนี้เงินเดือน - เงินเดือนที่ร้านต้องจ่ายให้พนักงาน":"สรุปเงินเดือนพนักงาน",32,52,778,"left",15);
  text(`งวด #${input.period.id}: ${input.period.startDate} ถึง ${input.period.endDate} | ล็อกแล้ว | หน่วย: บาท`,32,80,778);
  text(`ตัวกรอง: สาขา ${input.filters.branchId??"ทั้งหมด"} / แผนก ${input.filters.departmentId??"ทั้งหมด"}`,32,99,778);
  text(branch,32,120,778,"left",11);
  y=148;doc.rect(32,y,778,25).fill("#e8efeb");let x=32;labels.forEach((label,i)=>{text(label,x+5,y+5,widths[i]!-10,i>1&&i<(creditor?7:5)?"right":"left");x+=widths[i]!;});y+=29;
 };
 const newPage=(branch:string)=>{doc.addPage();pageHeader(branch);};
 const totals=(label:string,t:SalaryPayableTotals,branch:string)=>{
  const needed=creditor?70:48;if(y+needed>540)newPage(branch);
  doc.moveTo(32,y).lineTo(810,y).strokeColor("#8da79b").stroke();y+=7;
  text(`${label} | พนักงาน ${t.employeeCount} คน / ยอดสุทธิมากกว่าศูนย์ ${t.payableCount} คน`,32,y,778,"left",10);y+=20;
  text(`รายได้ ${t.earnings}    รายการหัก ${t.deductions}    สุทธิ ${t.net}`,32,y,778,"right",11);y+=22;
  if(creditor){text(`จ่ายแล้ว ${t.paid}    ค้างจ่าย ${t.outstanding}`,32,y,778,"right",11);y+=22;}
 };
 if(!input.branches.length){pageHeader("ไม่มีรายการตามตัวกรอง");}
 for(const [index,branch]of input.branches.entries()){
  if(index)doc.addPage();const title=`สาขา: ${branch.branchName} (#${branch.branchId})`;pageHeader(title);
  for(const row of branch.rows){
   const cells=creditor?[row.employeeCode,row.employeeName,row.earnings,row.deductions,row.net,row.paid,row.outstanding,statuses[row.status]]:[row.employeeCode,row.employeeName,row.earnings,row.deductions,row.net];
   doc.fontSize(9);const height=Math.max(29,...cells.map((cell,i)=>doc.heightOfString(cell,{width:widths[i]!-10,lineGap:2})+12));
   if(y+height>540)newPage(title);
   let x=32;cells.forEach((cell,i)=>{text(cell,x+5,y+5,widths[i]!-10,i>1&&i<(creditor?7:5)?"right":"left");x+=widths[i]!;});
   y+=height;doc.moveTo(32,y).lineTo(810,y).strokeColor("#e1e8e3").stroke();
  }
  totals("รวมสาขา",branch.totals,title);
 }
 totals("รวมทั้งหมดตามตัวกรอง",input.totals,"สรุปรวมตามตัวกรอง");
 const range=doc.bufferedPageRange();for(let i=range.start;i<range.start+range.count;i++){
  doc.switchToPage(i);doc.fontSize(8).fillColor("#53665f").text("อ้างอิงเงินเดือนที่ล็อกแล้ว สถานะจ่ายเป็นข้อมูล ณ เวลาเรียกรายงาน เอกสารนี้ไม่ใช่หลักฐานการโอนหรือจ่ายเงิน",32,550,{width:710,lineBreak:false});doc.text(`${i+1} / ${range.count}`,750,550,{width:60,align:"right",lineBreak:false});
 }
 doc.end();
});
