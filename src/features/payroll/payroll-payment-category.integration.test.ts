import { expect, test } from "bun:test";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";
import { ActionObserver } from "../../core/audit/action-observer";
import { DomainAuditObserver } from "../../core/audit/domain-audit-observer";
import { auditRepository } from "../audit/audit.repository";
import { createEmployeeService } from "../employee/employee.service";
import { createEmployeeBankAccountService } from "../employee-bank-account/employee-bank-account.service";
import { bankAccountRepository } from "../employee-bank-account/employee-bank-account.repository";
import { createPayrollPaymentService } from "./payroll-payment.service";
import { payrollPaymentRepository } from "./payroll-payment.repository";
import { seedPaymentFixture } from "./payroll-payment.test-support";
import { payrollActor } from "./payroll.test-support";

const dbTest = process.env.TEST_DATABASE_URL ? test : test.skip;
dbTest("explicit categories require their own destination and preserve prepared snapshots", async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const db = drizzle(pool, { schema });
  try {
    const f = await seedPaymentFixture(pool);
    const actor = { ...payrollActor(), accountId: f.actorId };
    const actions = new ActionObserver(db, auditRepository), domain = new DomainAuditObserver(auditRepository);
    const employee = createEmployeeService({ payroll: { serialize: async () => {} }, rootExecutor: db, transactionRunner: db, actions, domain });
    const bank = createEmployeeBankAccountService({ rootExecutor: db, transactionRunner: db, actions, domain, repository: bankAccountRepository, cipher: { encrypt: async () => "unused", decrypt: async () => "unused" } });
    const service = createPayrollPaymentService({ rootExecutor: db, transactionRunner: db, actions, domain, employee, bank, repository: payrollPaymentRepository });
    const command = { actor, requestId: f.key, periodId: f.periodId };
    const chosen = f.employees.find(e => e.kind === "cash")!;
    await employee.updatePaymentDestination({ ...command, employeeId: chosen.id, paymentMethod: "transfer", paymentCategory: "social_security", promptpayPhone: null });
    await expect(service.preparePayrollPayments(command)).rejects.toMatchObject({ code: "PAYMENT_DESTINATION_REQUIRED" });
    await pool.query("insert into employee_bank_accounts(employee_id,bank_code,bank_name,account_holder_name,account_number_ciphertext,account_number_last4) values($1,'004','Fixture','Test','fixture-cipher','1234')", [chosen.id]);
    const prepared = await service.preparePayrollPayments(command);
    const row = prepared.find(item => item.employeeId === chosen.id)!;
    expect(row.group).toBe("social_security");
    expect(row.payment?.paymentCategorySnapshot).toBe("social_security");
    expect(row.payment?.bankCodeSnapshot).toBe("004");
    await employee.updatePaymentDestination({ ...command, employeeId: chosen.id, paymentMethod: "cash", paymentCategory: "cash", promptpayPhone: null });
    expect((await service.listPaymentGroups(command)).find(item => item.employeeId === chosen.id)?.group).toBe("social_security");
    await expect(pool.query("update payroll_payments set payment_category_snapshot='cash' where id=$1", [row.payment!.id])).rejects.toMatchObject({ message: "Payment snapshots are immutable" });
    await expect(service.getPromptpayQr({ ...command, paymentId: String(row.payment!.id) })).rejects.toMatchObject({ code: "PAYMENT_QR_UNAVAILABLE" });
  } finally { await pool.end(); }
}, 20_000);
