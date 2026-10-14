import { test,expect } from "bun:test";
import { summarizePayslipItems } from "./payslip.document.service";
test("payslip groups locked items in exact cents and excludes technical zero-value evidence",()=>{
  const item={itemType:"base_salary",description:"Daily base salary",direction:"earning",amount:"100.01",occurredOn:"2026-09-01"};
  expect(summarizePayslipItems([item,{...item,amount:"99.99"},{...item,itemType:"other",amount:"0.00"},{...item,itemType:"social_security",direction:"deduction",amount:"10.00"}])).toEqual([{label:"ค่าจ้างพื้นฐาน",direction:"earning",amount:"200.00"},{label:"ประกันสังคม",direction:"deduction",amount:"10.00"}]);
});
