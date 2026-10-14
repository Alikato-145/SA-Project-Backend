import { afterEach, describe, expect, test } from "bun:test";
import { ActionObserver } from "../../core/audit/action-observer";
import { DomainAuditObserver } from "../../core/audit/domain-audit-observer";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { DatabaseExecutor } from "../../core/db/transaction";
import type { AuditEvent } from "../audit/audit.repository";
import { payslipRepository, type PayslipRow, type DeliveryRow } from "./payslip.repository";
import type { PayslipMailer } from "../../core/mail/smtp-mailer";
import { createPayslipService } from "./payslip.service";

const hr: AuthenticatedActor = {
  accountId: "9",
  employeeId: null,
  username: "hr",
  grants: [{ grantId: "1", roleCode: "HR", scope: "all", branchId: null, departmentId: null }],
};
const employee: AuthenticatedActor = {
  accountId: "8",
  employeeId: "1",
  username: "employee",
  grants: [{ grantId: "2", roleCode: "EMPLOYEE", scope: "self", branchId: null, departmentId: null }],
};
const originalRepository = { ...payslipRepository };
const row = (overrides: Partial<PayslipRow> = {}): PayslipRow => ({
  id: "101",
  payrollRecordId: "99",
  employeeId: "2",
  status: "generated",
  generatedAt: new Date("2026-09-28T00:00:00.000Z"),
  netPay: "1000.00",
  totalEarnings: "1200.00",
  totalDeductions: "200.00",
  fileStorageKey: "payslips/99.json",
  fileSha256: "hash",
  ...overrides,
});

afterEach(() => Object.assign(payslipRepository, originalRepository));

const service = (mailer: PayslipMailer = { async send() { return "message-1"; } }) => {
  const writer = {
    async insert(_executor: DatabaseExecutor, event: AuditEvent) {
      return { id: 1, action: event.action, requestId: event.requestId };
    },
  };
  return createPayslipService({
    rootExecutor: {} as DatabaseExecutor,
    transactionRunner: { async transaction(work) { return work({} as never); } },
    actions: new ActionObserver({} as DatabaseExecutor, writer),
    domain: new DomainAuditObserver(writer),
    mailer,
    storage: { async put() { return { sha256: "hash", size: 10 }; }, async read() { return Buffer.from("%PDF-TEST"); } },
  });
};

describe("payslip service", () => {
  test("upgrades legacy metadata once and preserves the payslip identity", async () => {
    let current = row(), upgrades = 0;
    payslipRepository.findLockedRecord = async () => ({ id: "99", employeeId: "2", netPay: "1000.00", totalEarnings: "1200.00", totalDeductions: "200.00" });
    payslipRepository.findByPayrollRecord = async () => current;
    payslipRepository.find = async () => current;
    payslipRepository.upgradeLegacyFile = async (_executor, id, oldKey, key, hash) => {
      expect(oldKey).toBe("payslips/99.json");
      upgrades += 1;
      current = { ...current, fileStorageKey: key, fileSha256: hash };
      return id;
    };
    expect((await service().generate(hr, "99", "legacy-upgrade")).id).toBe("101");
    expect(current.fileStorageKey.endsWith(".pdf")).toBe(true);
    expect((await service().generate(hr, "99", "legacy-repeat")).id).toBe("101");
    expect(upgrades).toBe(1);
  });

  test("rejects concurrent legacy upgrades without replacing the existing identity", async () => {
    payslipRepository.findLockedRecord = async () => ({ id: "99", employeeId: "2", netPay: "1000.00", totalEarnings: "1200.00", totalDeductions: "200.00" });
    payslipRepository.findByPayrollRecord = async () => row();
    payslipRepository.upgradeLegacyFile = async () => null;
    await expect(service().generate(hr, "99", "legacy-race")).rejects.toMatchObject({ code: "STATE_CONFLICT" });
  });

  test("denies voided and cross-employee PDF reads and delivery", async () => {
    payslipRepository.find = async () => row({ status: "voided" });
    await expect(service().download(hr, "101", "void-download")).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    await expect(service().deliver(hr, "101", "test@example.test", "void-delivery")).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    payslipRepository.find = async () => row();
    await expect(service().download(employee, "101", "cross-download")).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
    await expect(service().deliver(employee, "101", "test@example.test", "cross-delivery")).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
  });
  test("resolves only stale pending attempts after a documented provider check",async()=>{
    let pending:DeliveryRow={id:"1",recipientEmail:"test@example.test",status:"pending",attemptedAt:new Date(Date.now()-11*60*1000)};
    payslipRepository.findDeliveryForUpdate=async()=>pending;
    payslipRepository.finishDelivery=async(_executor,_id,status)=>({...pending,status});
    expect((await service().resolveDelivery(hr,"101","1","sent","ตรวจสอบกับผู้ให้บริการแล้ว","provider-message-1","resolve")).status).toBe("sent");
    await expect(service().resolveDelivery(employee,"101","1","sent","ตรวจสอบกับผู้ให้บริการแล้ว","provider-message-1","deny")).rejects.toMatchObject({code:"FORBIDDEN_SCOPE"});
    pending={...pending,attemptedAt:new Date()};
    await expect(service().resolveDelivery(hr,"101","1","failed","ตรวจสอบกับผู้ให้บริการแล้ว",undefined,"active")).rejects.toMatchObject({code:"STATE_CONFLICT"});
    pending={...pending,status:"sent"};
    await expect(service().resolveDelivery(hr,"101","1","failed","ตรวจสอบกับผู้ให้บริการแล้ว",undefined,"terminal")).rejects.toMatchObject({code:"STATE_CONFLICT"});
  });
  test("reuses the original PDF on repeated generation without inserting again", async () => {
    let inserts = 0;
    payslipRepository.findLockedRecord = async () => ({ id: "99", employeeId: "2", netPay: "1000.00", totalEarnings: "1200.00", totalDeductions: "200.00" });
    payslipRepository.findByPayrollRecord = async () => inserts ? row({fileStorageKey:"payslips/99/hash.pdf"}) : null;
    payslipRepository.insert = async () => {
      inserts += 1;
      if (inserts > 1) throw Object.assign(new Error("duplicate"), { code: "23505" });
      return "101";
    };
    payslipRepository.find = async () => row();

    expect((await service().generate(hr, "99", "payslip-create")).id).toBe("101");
    expect((await service().generate(hr,"99","payslip-duplicate")).id).toBe("101");
    expect(inserts).toBe(1);
  });

  test("denies an employee reading another employee's payslip", async () => {
    payslipRepository.find = async () => row({ employeeId: "2" });

    await expect(service().get(employee, "101", "payslip-cross-employee")).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
  });

  test("appends each delivery attempt without replacing prior attempts", async () => {
    const deliveries: DeliveryRow[] = [];
    payslipRepository.find = async () => row();
    payslipRepository.pendingDelivery = async () => null;
    payslipRepository.deliveryForRequest = async () => null;
    payslipRepository.addDelivery = async (_executor, _payslipId, recipientEmail) => {
      const delivery = { id: String(deliveries.length + 1), recipientEmail, status: "pending" as const, attemptedAt: new Date(`2026-09-28T00:00:0${deliveries.length}.000Z`) };
      deliveries.push(delivery);
      return delivery;
    };
    payslipRepository.listDeliveries = async () => deliveries;
    payslipRepository.finishDelivery = async (_executor, id, status) => {
      const attempt = deliveries.find((row) => row.id === id)!;
      attempt.status = status;
      return attempt;
    };

    await service().deliver(hr, "101", "first@example.test", "delivery-1");
    await service().deliver(hr, "101", "second@example.test", "delivery-2");

    expect(await service().deliveries(hr, "101", "delivery-list")).toMatchObject([
      { id: "1", recipientEmail: "first@example.test", status: "sent" },
      { id: "2", recipientEmail: "second@example.test", status: "sent" },
    ]);
    expect(deliveries).toHaveLength(2);
    expect((await service({ async send() { throw new Error("SMTP failure"); } }).deliver(hr, "101", "failed@example.test", "delivery-3")).status).toBe("failed");
    expect(deliveries).toHaveLength(3);
  });
});
