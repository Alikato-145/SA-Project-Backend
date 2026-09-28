import { and, eq } from "drizzle-orm";
import type { DatabaseExecutor } from "../../core/db/transaction";
import { payrollPeriods, payrollRecords } from "../payroll/payroll.schema";
import { employees } from "../employee/employee.schema";
import { employeeBankAccounts } from "../employee-bank-account/employee-bank-account.schema";

const id = (value: string) => Number(value);
export const reportRepository = {
  async lockedRows(executor: DatabaseExecutor, periodId: string) {
    return executor.select({ employeeCode: employees.employeeCode, employeeName: employees.firstName, employeeLastName: employees.lastName, baseSalary: payrollRecords.baseSalarySnapshot, netPay: payrollRecords.netPay, accountHolder: employeeBankAccounts.accountHolderName, accountCiphertext: employeeBankAccounts.accountNumberCiphertext, bankCode: employeeBankAccounts.bankCode }).from(payrollRecords).innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRecords.payrollPeriodId)).innerJoin(employees, eq(employees.id, payrollRecords.employeeId)).leftJoin(employeeBankAccounts, and(eq(employeeBankAccounts.employeeId, payrollRecords.employeeId), eq(employeeBankAccounts.isActive, true), eq(employeeBankAccounts.isPrimary, true))).where(and(eq(payrollRecords.payrollPeriodId, id(periodId)), eq(payrollRecords.status, "locked"), eq(payrollPeriods.status, "locked"))).limit(500);
  },
};
