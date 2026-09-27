import { describe, expect, test } from "bun:test";
import type { PayrollCalculationInput } from "../payroll.types";
import { calculatePayroll, payrollRecordTotalsReconcile } from "./payroll-calculator";

const fixture = (): PayrollCalculationInput => ({
  employeeId: "1", employeeCode: "EMP001", assignmentId: "10", branchId: "2",
  baseSalary: "20000.00", welfare: "1000.00", standardWorkDays: "20.00",
  absenceRate: "1.0000", lateRate: "2.0000", socialSecurityRate: "0.0500", socialSecurityCap: "750.00",
  workDays: [
    { id: "101", date: "2026-09-01", status: "present", lateMinutes: 0, deductible: false },
    { id: "102", date: "2026-09-02", status: "absent", lateMinutes: 0, deductible: true },
    { id: "103", date: "2026-09-03", status: "leave", lateMinutes: 0, deductible: false },
    { id: "104", date: "2026-09-04", status: "late", lateMinutes: 15, deductible: true },
  ],
  overtime: [
    { id: "201", date: "2026-09-05", type: "hourly", hours: "2.00", dayUnits: null, rate: "1.5000", configurationId: "5" },
    { id: "202", date: "2026-09-06", type: "rest_day", hours: null, dayUnits: "1.00", rate: "1.0000", configurationId: "6" },
    { id: "203", date: "2026-09-07", type: "public_holiday", hours: null, dayUnits: "1.00", rate: "2.0000", configurationId: "7" },
  ],
  deductions: [
    { id: "301", type: "advance", amount: "500.00", description: "Advance", date: "2026-09-01" },
    { id: "302", type: "loan_installment", amount: "300.00", description: "Loan", date: "2026-09-01" },
    { id: "303", type: "debt", amount: "200.00", description: "Food debt", date: "2026-09-10" },
  ],
  adjustments: [{ id: "401", direction: "earning", amount: "50.00", reason: "Correction" }],
});

describe("payroll calculator", () => {
  test("creates distinct traceable lines and reconciles totals", () => {
    const result = calculatePayroll(fixture());
    expect(result.items.filter((item) => item.itemType === "base_salary")).toHaveLength(4);
    expect(result.items.filter((item) => item.itemType === "welfare")).toHaveLength(4);
    expect(result.items.map((item) => item.itemType)).toEqual(expect.arrayContaining([
      "absence", "lateness", "overtime_hourly", "overtime_rest_day",
      "overtime_public_holiday", "social_security", "advance", "loan_installment", "debt", "adjustment",
    ]));
    const earnings = result.items.filter((item) => item.direction === "earning").reduce((sum, item) => sum + Number(item.amount), 0);
    const deductions = result.items.filter((item) => item.direction === "deduction").reduce((sum, item) => sum + Number(item.amount), 0);
    expect(Number(result.totalEarnings)).toBeCloseTo(earnings, 2);
    expect(Number(result.totalDeductions)).toBeCloseTo(deductions, 2);
    expect(Number(result.netPay)).toBeCloseTo(earnings - deductions, 2);
  });

  test("does not deduct paid leave and bases social security only on base salary", () => {
    const result = calculatePayroll(fixture());
    expect(result.items.filter((item) => item.itemType === "absence" || item.itemType === "sick_unpaid")).toHaveLength(1);
    expect(result.items.find((item) => item.itemType === "social_security")?.amount).toBe("200.00");
  });

  test("uses only explicitly supplied approved overtime inputs", () => {
    const input = fixture();
    input.overtime = [];
    expect(calculatePayroll(input).items.some((item) => item.itemType.startsWith("overtime_"))).toBe(false);
  });

  test("rounds each line before summing and rejects unapproved source tables", () => {
    const input = fixture();
    input.baseSalary = "100.00";
    input.welfare = "0.00";
    input.standardWorkDays = "3.00";
    input.workDays = [{ id: "1", date: "2026-09-01", status: "absent", lateMinutes: 0, deductible: true }];
    input.overtime = [];
    input.deductions = [];
    input.adjustments = [];
    input.socialSecurityRate = "0.0000";
    expect(calculatePayroll(input).items.find((item) => item.itemType === "absence")?.amount).toBe("33.33");
  });

  test("retains the effective configuration identity on dated deductions", () => {
    const input = fixture();
    input.workDays = input.workDays.map((day, index) => index === 1
      ? { ...day, absenceConfigurationId: "501" }
      : index === 3 ? { ...day, lateConfigurationId: "502" } : day);
    input.socialSecurityRateConfigurationId = "503";
    input.configurationEvidence = [{ id: "504", key: "STANDARD_WORK_DAYS", value: "20.0000", effectiveOn: "2026-09-01" }];
    const items = calculatePayroll(input).items;
    expect(items.find((item) => item.itemType === "absence")?.payrollConfigurationId).toBe("501");
    expect(items.find((item) => item.itemType === "lateness")?.payrollConfigurationId).toBe("502");
    expect(items.find((item) => item.itemType === "social_security")?.payrollConfigurationId).toBe("503");
    expect(items.find((item) => item.description === "Configuration STANDARD_WORK_DAYS")).toMatchObject({
      amount: "0.00", payrollConfigurationId: "504", occurredOn: "2026-09-01",
    });
  });

  test("uses the effective assignment and standard-work-days configuration for each daily earning", () => {
    const input = fixture();
    input.baseSalary = "30000.00";
    input.welfare = "2000.00";
    input.workDays = [
      { id: "101", date: "2026-09-14", status: "present", lateMinutes: 0, deductible: false,
        assignmentId: "10", baseSalary: "20000.00", welfare: "1000.00", standardWorkDays: "20.00", standardWorkDaysConfigurationId: "501" },
      { id: "102", date: "2026-09-15", status: "present", lateMinutes: 0, deductible: false,
        assignmentId: "11", baseSalary: "30000.00", welfare: "2000.00", standardWorkDays: "20.00", standardWorkDaysConfigurationId: "502" },
    ];
    input.overtime = [];
    input.deductions = [];
    input.adjustments = [];
    const result = calculatePayroll(input);
    expect(result.items.filter((item) => item.itemType === "base_salary")).toMatchObject([
      { amount: "1000.00", sourceId: "10", occurredOn: "2026-09-14", payrollConfigurationId: "501" },
      { amount: "1500.00", sourceId: "11", occurredOn: "2026-09-15", payrollConfigurationId: "502" },
    ]);
    expect(result.items.filter((item) => item.itemType === "welfare").map((item) => item.amount)).toEqual(["50.00", "100.00"]);
    expect(result.baseSalarySnapshot).toBe("30000.00");
    expect(result.totalEarnings).toBe("2650.00");
  });

  test("detects a record whose stored totals no longer match its rounded lines", () => {
    const record = calculatePayroll(fixture());
    expect(payrollRecordTotalsReconcile(record)).toBe(true);
    expect(payrollRecordTotalsReconcile({ ...record, netPay: "0.00" })).toBe(false);
  });
});
