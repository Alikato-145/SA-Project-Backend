import { describe, expect, test } from "bun:test";
import type { DebtTransaction } from "./debt.dto";
import { DebtError, type DebtRepository, type DebtSession } from "./debt.repository";
import { DebtService } from "./debt.service";

const charge: DebtTransaction = {
  id: 1, employeeId: 10, debtTypeId: 4, transactionKind: "charge",
  transactionDate: "2026-09-22", description: "Food", amount: "40.00",
  originalTransactionId: null, recordedByUserAccountId: 2,
  settledInPayrollRecordId: null, settledAt: null,
  createdAt: new Date(), updatedAt: new Date(),
};
const fixture = () => {
  const rows: DebtTransaction[] = [{ ...charge }];
  const session: DebtSession = {
    async findType() { return { id: 4, isActive: true }; },
    async insert(input) {
      const row = { ...charge, ...input, id: rows.length + 1 };
      rows.push(row);
      return row;
    },
    async findByIdForUpdate(id) { return rows.find((row) => row.id === id); },
    async hasReversal(id) { return rows.some((row) => row.originalTransactionId === id); },
  };
  const repository: DebtRepository = {
    async withTransaction(work) { return work(session); },
    async listByEmployee() { return rows; },
  };
  const access = {
    async assertCanRecord() {}, async assertCanRead() {},
  };
  return { service: new DebtService(repository, access, () => "2026-09-22"), session, access, rows };
};
describe("append-only debt", () => {
  test("charge and reversal retain both records and net to zero", async () => {
    const f = fixture();
    const reversed = await f.service.reverse({ accountId: 2 }, 1, "Correction");
    expect(reversed.originalTransactionId).toBe(1);
    const ledger = await f.service.getLedger({ accountId: 2 }, 10);
    expect(ledger.entries).toHaveLength(2);
    expect(ledger.balance).toBe("0.00");
  });
  test("rejects second reversal and settled target", async () => {
    const f = fixture();
    await f.service.reverse({ accountId: 2 }, 1, "Correction");
    await expect(f.service.reverse({ accountId: 2 }, 1, "Again"))
      .rejects.toMatchObject({ code: "DEBT_ALREADY_REVERSED" });
    const settled = fixture();
    settled.rows[0]!.settledAt = new Date();
    await expect(settled.service.reverse({ accountId: 2 }, 1, "Correction"))
      .rejects.toMatchObject({ code: "DEBT_ALREADY_SETTLED" });
  });
  test("requires active type and scoped actor before insertion", async () => {
    const f = fixture();
    f.session.findType = async () => ({ id: 4, isActive: false });
    await expect(f.service.record({ accountId: 2 }, {
      employeeId: 10, debtTypeId: 4, transactionKind: "charge",
      amount: "10.00", description: "Meal",
    })).rejects.toMatchObject({ code: "DEBT_TYPE_UNAVAILABLE" });
    f.access.assertCanRecord = async () => { throw new DebtError("OUT_OF_SCOPE"); };
    await expect(f.service.record({ accountId: 2 }, {
      employeeId: 10, debtTypeId: 4, transactionKind: "charge",
      amount: "10.00", description: "Meal",
    })).rejects.toMatchObject({ code: "OUT_OF_SCOPE" });
  });
  test("excludes reversed entries from payroll candidates", async () => {
    const f = fixture();
    await f.service.reverse({ accountId: 2 }, 1, "Correction");
    expect(await f.service.findCandidatesForPayroll({ accountId: 2 }, 10, "2026-09-30")).toEqual([]);
  });
});
