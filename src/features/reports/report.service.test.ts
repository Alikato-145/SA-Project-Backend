import { afterEach, expect, test } from "bun:test";
import { ActionObserver } from "../../core/audit/action-observer";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { DatabaseExecutor } from "../../core/db/transaction";
import type { AuditEvent } from "../audit/audit.repository";
import { reportRepository } from "./report.repository";
import { createReportService } from "./report.service";

const hr: AuthenticatedActor = {
  accountId: "9",
  employeeId: null,
  username: "hr",
  grants: [{ grantId: "1", roleCode: "HR", scope: "all", branchId: null, departmentId: null }],
};
const originalRepository = { ...reportRepository };

afterEach(() => Object.assign(reportRepository, originalRepository));

test("social-security CSV uses the base-salary snapshot, not the net pay", async () => {
  reportRepository.lockedRows = async () => [{
    employeeCode: "E001",
    employeeName: "Ada",
    employeeLastName: "Lovelace",
    baseSalary: "20000.00",
    netPay: "24500.00",
    accountHolder: null,
    accountCiphertext: null,
    bankCode: null,
  }];
  const writer = {
    async insert(_executor: DatabaseExecutor, event: AuditEvent) {
      return { id: 1, action: event.action, requestId: event.requestId };
    },
  };
  const service = createReportService({
    rootExecutor: {} as DatabaseExecutor,
    actions: new ActionObserver({} as DatabaseExecutor, writer),
    cipher: { async encrypt() { return ""; }, async decrypt() { return ""; } },
  });

  expect(await service.socialSecurity(hr, "20", "social-security")).toBe(
    '"employee_code","employee_name","base_salary"\r\n"E001","Ada Lovelace","20000.00"\r\n',
  );
});
