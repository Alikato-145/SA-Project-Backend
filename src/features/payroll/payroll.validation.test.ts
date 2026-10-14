import { expect, test } from "bun:test";
import { assertPayrollConfigurationValue, assertPayrollMonthRange, parsePayrollId, parsePayrollMoney } from "./payroll.validation";

test("configuration bounds prevent zero divisors, ratio percentages and decimal overflow", () => {
  for (const value of ["0", "0.0001", "26.0001", "31.0001", "99999999999"]) expect(() => assertPayrollConfigurationValue("STANDARD_WORK_DAYS", value)).toThrow();
  for (const value of ["0.01", "26.50", "26", "31"]) expect(() => assertPayrollConfigurationValue("STANDARD_WORK_DAYS", value)).not.toThrow();
  expect(() => assertPayrollConfigurationValue("SOCIAL_SECURITY_RATE", "5")).toThrow();
  for (const value of ["0", "0.0500", "1.0000"]) expect(() => assertPayrollConfigurationValue("SOCIAL_SECURITY_RATE", value)).not.toThrow();
  expect(() => assertPayrollConfigurationValue("SOCIAL_SECURITY_CAP", "9999999999.9999")).toThrow();
});

test("social security caps retain cents and reject amounts requiring rounding",()=>{
  for(const value of ["0","750","750.1200","9999999999.99"]) expect(()=>assertPayrollConfigurationValue("SOCIAL_SECURITY_CAP",value)).not.toThrow();
  for(const value of ["750.1234","0.0001","10000000000"]) expect(()=>assertPayrollConfigurationValue("SOCIAL_SECURITY_CAP",value)).toThrow();
});

test("period dates match calendar months including leap years and IDs never round",()=>{
  expect(()=>assertPayrollMonthRange(2028,2,"2028-02-01","2028-02-29")).not.toThrow();
  expect(()=>assertPayrollMonthRange(2026,2,"2026-02-01","2026-02-29")).toThrow();
  expect(()=>assertPayrollMonthRange(2026,9,"2026-09-02","2026-09-30")).toThrow();
  expect(()=>assertPayrollMonthRange(2026,9,"2026-09-01","2026-10-01")).toThrow();
  expect(parsePayrollId("9007199254740991","id")).toBe("9007199254740991");
  expect(()=>parsePayrollId("9007199254740992","id")).toThrow();
});

test("money rejects sub-cent adjustments and database overflow before persistence",()=>{
  expect(parsePayrollMoney("100.2300","amount",true)).toBe("100.2300");
  expect(parsePayrollMoney("9999999999.99","amount",true)).toBe("9999999999.99");
  for(const value of ["0.0001","1.2345","10000000000","0"])expect(()=>parsePayrollMoney(value,"amount",true)).toThrow();
});
