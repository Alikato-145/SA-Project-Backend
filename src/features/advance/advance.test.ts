import { describe, expect, test } from "bun:test";
import { AdvanceService, type AdvanceAccess, type AdvanceEligibility, type AdvanceProjection } from "./advance.service";
import { AdvanceError, type AdvanceRepository } from "./advance.repository";
import type { AdvanceRecord } from "./advance.dto";

const request: AdvanceRecord = {
  id: 1, employeeId: 10, requestMonth: "2026-09-01", amount: "5000.00",
  status: "pending", requestedByUserAccountId: 2,
  requestedAt: new Date("2026-09-20T10:00:00+07:00"),
  decidedByUserAccountId: null, decidedAt: null, decisionNote: null,
  createdAt: new Date(), updatedAt: new Date(),
};
const actor = { accountId: 2 };
const fixture = (today = "2026-09-20") => {
  let record = { ...request };
  let decisions = 0;
  const repository: AdvanceRepository = {
    async insert(command) { return { ...record, ...command }; },
    async findById() { return record; },
    async decide(_id, status) { decisions++; record = { ...record, status }; return record; },
    async listByEmployee() { return [record]; },
    async findApprovedForMonth() { return record.status === "approved" ? [record] : []; },
  };
  const access: AdvanceAccess = {
    async assertCanRequest() {}, async assertCanDecide() {}, async assertCanRead() {},
  };
  const eligibility: AdvanceEligibility = {
    async getWorkedDays() { return 20; },
    async getBaseSalary() { return "10000.00"; },
  };
  const projection: AdvanceProjection = { async netPayAfterAdvance() { return "0.00"; } };
  return { service: new AdvanceService(repository, access, eligibility, projection, () => today),
    repository, access, eligibility, projection, get decisions() { return decisions; } };
};

describe("advance eligibility", () => {
  test("rejects day 19 and permits day 20", async () => {
    await expect(fixture("2026-09-19").service.submitAdvance(actor, 10, "5000.00"))
      .rejects.toMatchObject({ code: "ADVANCE_INELIGIBLE_DATE" });
    expect((await fixture().service.submitAdvance(actor, 10, "5000.00")).status).toBe("pending");
  });
  test("checks worked days 19 versus 20 before approval", async () => {
    const f = fixture();
    f.eligibility.getWorkedDays = async () => 19;
    await expect(f.service.approveAdvance(actor, 1)).rejects.toMatchObject({ code: "ADVANCE_WORK_DAYS_INSUFFICIENT" });
    expect(f.decisions).toBe(0);
  });
  test("enforces half salary in exact cents", async () => {
    const f = fixture();
    f.repository.findById = async () => ({ ...request, amount: "5000.01" });
    await expect(f.service.approveAdvance(actor, 1)).rejects.toMatchObject({ code: "ADVANCE_HALF_SALARY_EXCEEDED" });
    expect((await fixture().service.approveAdvance(actor, 1)).status).toBe("approved");
  });
  test("denies projected negative net pay", async () => {
    const f = fixture();
    f.projection.netPayAfterAdvance = async () => "-0.01";
    await expect(f.service.approveAdvance(actor, 1)).rejects.toMatchObject({ code: "ADVANCE_NEGATIVE_NET_PAY" });
  });
  test("denies out-of-scope decisions before writes", async () => {
    const f = fixture();
    f.access.assertCanDecide = async () => { throw new AdvanceError("OUT_OF_SCOPE"); };
    await expect(f.service.approveAdvance(actor, 1)).rejects.toMatchObject({ code: "OUT_OF_SCOPE" });
    expect(f.decisions).toBe(0);
  });
});
