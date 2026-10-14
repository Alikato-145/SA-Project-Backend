import PDFDocument from "pdfkit";
import { fileURLToPath } from "node:url";
import { money, formatMoney } from "../payroll/calculation/decimal";

export type PayslipDocumentInput = {
  id: string; employeeId: string; netPay: string; totalEarnings: string; totalDeductions: string;
  employeeCode?: string; employeeName?: string; periodStart?: string; periodEnd?: string; lockedAt?: Date | null;
  items?: { itemType?: string; description: string; direction: string; amount: string; occurredOn: string | null }[];
};

const labels:Record<string,string>={base_salary:"ค่าจ้างพื้นฐาน",welfare:"สวัสดิการ",overtime_hourly:"OT รายชั่วโมง",overtime_rest_day:"OT วันหยุดประจำสัปดาห์",overtime_public_holiday:"OT วันหยุดนักขัตฤกษ์",absence:"หักขาดงาน",lateness:"หักมาสาย",sick_unpaid:"หักลาไม่รับค่าจ้าง",social_security:"ประกันสังคม",advance:"เงินเบิกล่วงหน้า",loan_installment:"ค่างวดเงินกู้",debt:"หนี้พนักงาน",adjustment:"รายการปรับปรุง",other:"รายการอื่น"};
export const summarizePayslipItems=(items:NonNullable<PayslipDocumentInput["items"]>)=>{
  const groups=new Map<string,{label:string;direction:string;amount:bigint}>();
  for(const item of items) {
    const amount=money(item.amount);if(amount===0n)continue;
    const key=`${item.itemType ?? item.description}:${item.direction}`;
    const group=groups.get(key) ?? {label:labels[item.itemType ?? ""] ?? "รายการอื่น",direction:item.direction,amount:0n};
    group.amount+=amount;groups.set(key,group);
  }
  return [...groups.values()].map(group=>({...group,amount:formatMoney(group.amount)}));
};

export const renderPayslip = (input: PayslipDocumentInput): Promise<Buffer> => new Promise((resolve, reject) => {
  const document = new PDFDocument({ size: "A4", margin: 45, info: { Title: `Payslip ${input.id}`, Author: "Haris Payroll", CreationDate: input.lockedAt ?? new Date("2026-01-01T00:00:00Z") } });
  const chunks: Buffer[] = [];
  document.on("data", (chunk) => chunks.push(chunk));
  document.on("end", () => resolve(Buffer.concat(chunks)));
  document.on("error", reject);
  document.font(fileURLToPath(new URL("./assets/NotoSansThai.ttf", import.meta.url)));
  document.fontSize(22).fillColor("#173d32").text("Haris Payroll");
  document.fontSize(16).text("สลิปเงินเดือน", { align: "right" });
  document.moveDown().fillColor("#172421").fontSize(11);
  document.text(`พนักงาน: ${input.employeeName ?? `#${input.employeeId}`}`);
  document.text(`รหัสพนักงาน: ${input.employeeCode ?? input.employeeId} | รายการเงินเดือน: ${input.id}`);
  document.text(`ช่วงเงินเดือน: ${input.periodStart ?? "-"} ถึง ${input.periodEnd ?? "-"}`);
  document.moveDown();
  document.text("รายการจากงวดที่ล็อกแล้ว", { underline: true });
  for (const item of summarizePayslipItems(input.items ?? [])) {
    if (document.y > 730) document.addPage();
    const y=document.y;
    document.fontSize(11).text(item.label,45,y,{width:370});
    document.text(`${item.direction === "deduction" ? "−" : ""}${item.amount}`,420,y,{width:130,align:"right"});
  }
  if (document.y > 670) document.addPage();
  document.x=45;
  document.moveDown().fontSize(12);
  document.text(`รายได้รวม: ${input.totalEarnings} บาท`);
  document.text(`รายการหักรวม: ${input.totalDeductions} บาท`);
  document.fillColor("#173d32").fontSize(16).text(`เงินสุทธิ: ${input.netPay} บาท`);
  document.moveDown().fillColor("#53665f").fontSize(9).text("เอกสารนี้อ้างอิงผลคำนวณที่ล็อกแล้ว ไม่ใช่หลักฐานยืนยันการโอนหรือจ่ายเงิน");
  document.end();
});
