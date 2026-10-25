import { describe, expect, test } from "bun:test";
import { AdvanceService, type AdvanceAccess, type AdvanceEligibility, type AdvanceProjection } from "./advance.service";
import { AdvanceError, type AdvanceRepository } from "./advance.repository";
import type { AdvanceRecord } from "./advance.dto";

const request: AdvanceRecord = {
  id: 1, employeeId: 10, requestMonth: "2026-09-01", amount: "5000.00", reason: null,
  status: "pending", requestedByUserAccountId: 2,
  requestedAt: new Date("2026-09-20T10:00:00+07:00"),
  decidedByUserAccountId: null, decidedAt: null, decisionNote: null,
  createdAt: new Date(), updatedAt: new Date(),
};
const actor = { accountId: 2 };
const fixture = (today = "2026-09-20") => {
  let record = { ...request };
  let decisions = 0;
  let inserts = 0;
  const repository: AdvanceRepository = {
    async insert(command) { inserts++; record = { ...record, ...command }; return record; },
    async findById() { return record; },
    async decide(_id, status, _actor, note) { decisions++; record = { ...record, status, decisionNote: note ?? null }; return record; },
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
    repository, access, eligibility, projection, get decisions() { return decisions; }, get inserts() { return inserts; } };
};

describe("advance eligibility", () => {
  test("rejects day 19 and permits day 20", async () => {
    await expect(fixture("2026-09-19").service.submitAdvance(actor, 10, "5000.00", "Emergency household expenses"))
      .rejects.toMatchObject({ code: "ADVANCE_INELIGIBLE_DATE" });
    expect((await fixture().service.submitAdvance(actor, 10, "5000.00", "Emergency household expenses")).status).toBe("pending");
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

test("configured advance thresholds replace defaults and retain exact salary caps",async()=>{
 const f=fixture();const service=new AdvanceService(f.repository,f.access,f.eligibility,f.projection,()=>"2026-09-25",{requestDay:25,workedDays:21,salaryRatio:"0.4000"});
 await expect(service.approveAdvance(actor,1)).rejects.toMatchObject({code:"ADVANCE_INELIGIBLE_DATE"});
 f.repository.findById=async()=>({...request,requestedAt:new Date("2026-09-25T10:00:00+07:00"),amount:"4000.00"});
 await expect(service.approveAdvance(actor,1)).rejects.toMatchObject({code:"ADVANCE_WORK_DAYS_INSUFFICIENT"});
 f.eligibility.getWorkedDays=async()=>21;
 expect((await service.approveAdvance(actor,1)).status).toBe("approved");
 f.repository.findById=async()=>({...request,requestedAt:new Date("2026-09-25T10:00:00+07:00"),amount:"4000.01"});
 await expect(service.approveAdvance(actor,1)).rejects.toMatchObject({code:"ADVANCE_HALF_SALARY_EXCEEDED"});
});


describe("UC12 advance reasons", () => {
  for (const reason of [undefined, null, "", " \n\t ", "x".repeat(1001)]) test(`rejects invalid new reason ${JSON.stringify(reason)?.slice(0,30)} before insert`, async () => {
    const f = fixture();
    await expect(f.service.submitAdvance(actor,10,"100.01",reason as string)).rejects.toMatchObject({code:"VALIDATION_ERROR"});
    expect(f.inserts).toBe(0);
  });
  test("trims reason, preserves it on read, and accepts exactly 1000 characters", async () => {
    const f = fixture();
    expect(await f.service.submitAdvance(actor,10,"100.01","  Emergency household expenses  ")).toMatchObject({reason:"Emergency household expenses"});
    expect(await f.service.listRequests(actor,10)).toMatchObject([{reason:"Emergency household expenses"}]);
    expect((await f.service.submitAdvance(actor,10,"100.01","x".repeat(1000))).reason).toHaveLength(1000);
  });
  for (const note of [undefined, null, "", " \n\t ", "x".repeat(1001)]) test(`rejects invalid rejection note ${JSON.stringify(note)?.slice(0,30)} without decision`, async () => {
    const f = fixture();
    await expect(f.service.rejectAdvance(actor,1,note as string)).rejects.toMatchObject({code:"VALIDATION_ERROR"});
    expect(f.decisions).toBe(0);
  });
  test("persists trimmed rejection note and leaves legacy reason NULL", async () => {
    const f = fixture();
    expect(await f.service.rejectAdvance(actor,1,"  Explain repayment capacity  ")).toMatchObject({status:"rejected",reason:null,decisionNote:"Explain repayment capacity"});
    expect(await f.service.listRequests(actor,10)).toMatchObject([{reason:null,decisionNote:"Explain repayment capacity"}]);
  });
});
