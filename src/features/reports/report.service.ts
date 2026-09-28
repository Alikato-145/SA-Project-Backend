import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { DatabaseExecutor } from "../../core/db/transaction";
import type { ActionObserver } from "../../core/audit/action-observer";
import { createActionContext } from "../../core/audit/action-context";
import { assertPayrollMutationAccess } from "../payroll/payroll.authorization";
import type { BankAccountCipher } from "../employee-bank-account/employee-bank-account.crypto";
import { reportRepository } from "./report.repository";

const csv = (rows: readonly string[][]) => rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\r\n") + "\r\n";
const authorize = (actor: AuthenticatedActor) => assertPayrollMutationAccess(actor);
export const createReportService = (dependencies: { rootExecutor: DatabaseExecutor; actions: ActionObserver; cipher: BankAccountCipher }) => ({
  async bankTransfer(actor: AuthenticatedActor, periodId: string, requestId: string) {
    const context = createActionContext({ actor, requestId, actionBase: "report.bank-transfer.export", target: { tableName: "payroll_records", recordId: periodId } });
    return dependencies.actions.observeRead(context, async () => {
      authorize(actor);
      const rows = await reportRepository.lockedRows(dependencies.rootExecutor, periodId);
      const body = await Promise.all(rows.filter((row) => row.accountCiphertext !== null).map(async (row) => [row.bankCode ?? "", await dependencies.cipher.decrypt(row.accountCiphertext!), row.accountHolder ?? "", row.netPay]));
      return csv([["bank_code", "account_number", "account_holder", "net_pay"], ...body]);
    });
  },
  async socialSecurity(actor: AuthenticatedActor, periodId: string, requestId: string) {
    const context = createActionContext({ actor, requestId, actionBase: "report.social-security.export", target: { tableName: "payroll_records", recordId: periodId } });
    return dependencies.actions.observeRead(context, async () => {
      authorize(actor);
      const rows = await reportRepository.lockedRows(dependencies.rootExecutor, periodId);
      return csv([["employee_code", "employee_name", "base_salary"], ...rows.map((row) => [row.employeeCode, `${row.employeeName} ${row.employeeLastName}`, row.baseSalary])]);
    });
  },
});
export type ReportService = ReturnType<typeof createReportService>;
