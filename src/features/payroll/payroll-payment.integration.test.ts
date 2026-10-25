import { expect, test } from "bun:test";
import { Pool } from "pg";
import * as schema from "../../db/schema";
import { drizzle } from "drizzle-orm/node-postgres";
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
import { toPayrollPaymentResponseDto } from "./payroll-payment.mapper";
const dbTest = process.env.TEST_DATABASE_URL ? test : test.skip;
dbTest("real concurrent preparation, rollback, immutable snapshots and database guards", async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const db = drizzle(pool, { schema });
  try {
    const f = await seedPaymentFixture(pool);
    const actor = { ...payrollActor(), accountId: f.actorId };
    const actions = new ActionObserver(db, auditRepository);
    const domain = new DomainAuditObserver(auditRepository);
    const employee = createEmployeeService({ payroll: { serialize: async () => { } }, rootExecutor: db, transactionRunner: db, actions, domain });
    const bank = createEmployeeBankAccountService({ rootExecutor: db, transactionRunner: db, actions, domain, repository: bankAccountRepository, cipher: { encrypt: async () => "unused", decrypt: async () => "unused" } });
    const dependencies = { rootExecutor: db, transactionRunner: db, actions, domain, employee, bank, repository: payrollPaymentRepository };
    const service = createPayrollPaymentService(dependencies);
    const command = { actor, requestId: f.key, periodId: f.periodId };
    const broken = f.employees.find(e => e.kind === "transfer")!;
    await pool.query("update employees set promptpay_phone=null where id=$1", [broken.id]);
    await expect(service.preparePayrollPayments(command)).rejects.toMatchObject({ code: "PAYMENT_DESTINATION_REQUIRED" });
    expect((await pool.query("select count(*) from payroll_payments p join payroll_records r on r.id=p.payroll_record_id where r.payroll_period_id=$1", [f.periodId])).rows[0].count).toBe("0");
    await pool.query("update employees set promptpay_phone='0812345678' where id=$1", [broken.id]);
    // Force a failure after persistence, proving transaction rollback rather than prevalidation only.
    const failing = createPayrollPaymentService({ ...dependencies, repository: { ...payrollPaymentRepository, async insert(...args) { await payrollPaymentRepository.insert(...args); throw new Error("deliberate failure after insert"); } } });
    await expect(failing.preparePayrollPayments(command)).rejects.toThrow("deliberate failure after insert");
    expect((await pool.query("select count(*) from payroll_payments p join payroll_records r on r.id=p.payroll_record_id where r.payroll_period_id=$1", [f.periodId])).rows[0].count).toBe("0");
    const results = await Promise.all([service.preparePayrollPayments({ ...command, requestId: `${f.key}-a` }), service.preparePayrollPayments({ ...command, requestId: `${f.key}-b` })]);
    expect(results.map(rows => rows.filter(r => r.payment).length)).toEqual([6, 6]);
    expect((await pool.query("select count(*) from payroll_payments p join payroll_records r on r.id=p.payroll_record_id where r.payroll_period_id=$1", [f.periodId])).rows[0].count).toBe("6");
    const transfer = results[0]!.find(r => r.employeeId === broken.id)!;
    const p = transfer.payment!;
    await employee.updatePaymentDestination({ ...command, employeeId: broken.id, paymentMethod: "cash", promptpayPhone: "0899999999" });
    const again = await service.preparePayrollPayments(command);
    expect(again.find(r => r.employeeId === broken.id)?.payment).toEqual(p);
    const qr = await service.getPromptpayQr({ ...command, paymentId: String(p.id) });
    expect(qr.phone).toBe("0812345678");
    expect(qr.amount).toBe("123.45");
    const publicJson = JSON.stringify(again.map(toPayrollPaymentResponseDto));
    expect(publicJson).not.toContain("verification-only-opaque-envelope");
    expect(publicJson).not.toContain("ciphertext");
    await expect(pool.query("update payroll_payments set amount=1 where id=$1", [p.id])).rejects.toBeDefined();
    await expect(pool.query("delete from payroll_payments where id=$1", [p.id])).rejects.toBeDefined();
    await expect(pool.query("update payroll_payments set status='paid' where id=$1", [p.id])).rejects.toBeDefined();
    for (const row of again.filter(r => r.payment && !r.member && r.paymentMethod === "cash"))
      await expect(service.getPromptpayQr({ ...command, paymentId: String(row.payment!.id) })).rejects.toMatchObject({ code: "PAYMENT_QR_UNAVAILABLE" });
    const member = again.find(r => r.member)!;
    const frozenBank = member.payment!;
    await pool.query("update employee_bank_accounts set bank_code='999',account_holder_name='Changed live holder',account_number_ciphertext='changed-live-envelope',account_number_last4='9876' where id=$1", [frozenBank.employeeBankAccountId]);
    const sourceAssignment = (await pool.query("select employment_assignment_id from payroll_records where id=$1", [member.recordId])).rows[0].employment_assignment_id;
    await pool.query("update employment_assignments set effective_to='2095-10-31' where id=$1", [sourceAssignment]);
    await pool.query("insert into employment_assignments(employee_id,branch_id,department_id,position_id,base_salary,effective_from,is_social_security_member) select employee_id,$2,(select id from departments where branch_id=$2 limit 1),position_id,40000,'2095-11-01',false from employment_assignments where id=$1", [sourceAssignment, f.branches[1]]);
    const afterLiveChanges = await service.preparePayrollPayments(command);
    expect(afterLiveChanges.find(r => r.recordId === member.recordId)?.payment).toEqual(frozenBank);
    expect(afterLiveChanges.find(r => r.recordId === member.recordId)?.branchId).toBe(Number(f.branches[0]));
    expect(afterLiveChanges.find(r => r.recordId === member.recordId)?.group).toBe("social_security");

    await expect(service.getPromptpayQr({ ...command, paymentId: String(member.payment!.id) })).rejects.toMatchObject({ code: "PAYMENT_QR_UNAVAILABLE" });
    const paid = again.find(r => r.group === "transfer" && r.payment && r.employeeId !== broken.id)!;
    await pool.query("update payroll_payments set status='paid',paid_at=now(),paid_by_user_account_id=$2 where id=$1", [paid.payment!.id, f.actorId]);
    await expect(service.getPromptpayQr({ ...command, paymentId: String(paid.payment!.id) })).rejects.toMatchObject({ code: "PAYMENT_QR_UNAVAILABLE" });
    await pool.query("update payroll_payments set status='cancelled',cancelled_at=now(),cancelled_by_user_account_id=$2,cancellation_reason='fixture correction' where id=$1", [p.id, f.actorId]);
    await expect(service.getPromptpayQr({ ...command, paymentId: String(p.id) })).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    const insert = "insert into payroll_payments(payroll_record_id,branch_id_snapshot,payment_method,amount,prepared_by_user_account_id,promptpay_phone_snapshot) values($1,$2,$3,$4,$5,$6)";
    await expect(pool.query(insert, [broken.recordId, broken.branchId, "cash", "1.00", f.actorId, null])).rejects.toMatchObject({ message: "Payment requires full locked payroll snapshot" });
    await expect(pool.query(insert, [broken.recordId, f.branches[1], "cash", "123.45", f.actorId, null])).rejects.toMatchObject({ message: "Payment requires full locked payroll snapshot" });
    await expect(pool.query(insert, [broken.recordId, broken.branchId, "cash", "123.45", f.actorId, "0812345678"])).rejects.toMatchObject({ constraint: "chk_payment_destination" });
    await expect(pool.query(insert, [broken.recordId, broken.branchId, "transfer", "123.45", f.actorId, null])).rejects.toMatchObject({ message: "Missing required payment destination" });
    const bankTuple = "insert into payroll_payments(payroll_record_id,branch_id_snapshot,payment_method,amount,prepared_by_user_account_id,promptpay_phone_snapshot,bank_code_snapshot) values($1,$2,'transfer','123.45',$3,'0812345678','004')";
    await expect(pool.query(bankTuple, [broken.recordId, broken.branchId, f.actorId])).rejects.toMatchObject({ constraint: "chk_payment_bank_tuple" });
    // A cancelled row is preserved and permits exactly one deliberate fresh snapshot.
    const replaced = await service.preparePayrollPayments(command);
    expect(replaced.find(r => r.employeeId === broken.id)?.payment?.id).not.toBe(p.id);
    await expect(pool.query(insert, [broken.recordId, broken.branchId, "cash", "123.45", f.actorId, null])).rejects.toMatchObject({ constraint: "payroll_payments_active_record_uidx" });
    await expect(pool.query("update payroll_payments set status='cancelled',cancelled_at=now(),cancelled_by_user_account_id=$2,cancellation_reason='' where id=$1", [member.payment!.id, f.actorId])).rejects.toMatchObject({ constraint: "chk_payment_lifecycle" });
  }
  finally {
    await pool.end();
  }
}, 20000);
