import { describe, expect, test } from "bun:test";
import type {
  BranchSchedule,
  BranchScheduleOverride,
  CreateBranchScheduleCommand,
} from "./branch-schedule.dto";
import {
  BranchScheduleError,
  type BranchScheduleRepository,
} from "./branch-schedule.repository";
import { BranchScheduleService } from "./branch-schedule.service";

const schedule: BranchSchedule = {
  id: 1,
  branchId: 10,
  workStartTime: "09:00:00",
  standardCloseTime: "18:00:00",
  lateGraceMinutes: 10,
  effectiveFrom: "2026-09-01",
  effectiveTo: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const override: BranchScheduleOverride = {
  id: 2,
  branchId: 10,
  scheduleDate: "2026-09-10",
  isClosed: false,
  workStartTime: "10:00:00",
  closeTime: "19:00:00",
  reason: "Special event",
  createdByUserAccountId: 7,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const command: CreateBranchScheduleCommand = {
  branchId: 10,
  workStartTime: "09:00:00",
  standardCloseTime: "18:00:00",
  lateGraceMinutes: 10,
  effectiveFrom: "2026-09-01",
  effectiveTo: null,
};

const makeRepository = (): BranchScheduleRepository & {
  insertCalls: number;
  lastOverrideCommand?: Parameters<BranchScheduleRepository["upsertOverride"]>[0];
} => ({
  insertCalls: 0,
  async insertSchedule(value) {
    this.insertCalls += 1;
    return { ...schedule, ...value };
  },
  async findScheduleById() {
    return schedule;
  },
  async listSchedules() {
    return [schedule];
  },
  async updateSchedule(_id, value) {
    return { ...schedule, ...value };
  },
  async findApplicableSchedule() {
    return schedule;
  },
  async findOverride() {
    return undefined;
  },
  async upsertOverride(value) {
    this.lastOverrideCommand = value;
    return { ...override, ...value };
  },
});

describe("BranchScheduleService", () => {
  test("denies scope before schedule persistence", async () => {
    const repository = makeRepository();
    const service = new BranchScheduleService(repository, {
      async assertCanManageBranch() {
        throw new BranchScheduleError("OUT_OF_SCOPE");
      },
    });

    await expect(service.createSchedule({ accountId: 7 }, command)).rejects.toMatchObject({
      code: "OUT_OF_SCOPE",
    });
    expect(repository.insertCalls).toBe(0);
  });

  test("rejects invalid date ranges, closing times, and negative grace", async () => {
    const service = new BranchScheduleService(makeRepository(), {
      async assertCanManageBranch() {},
    });

    for (const invalid of [
      { ...command, lateGraceMinutes: -1 },
      { ...command, standardCloseTime: "09:00:00" },
      { ...command, effectiveTo: "2026-08-31" },
    ]) {
      await expect(service.createSchedule({ accountId: 7 }, invalid)).rejects.toMatchObject({
        code: "INVALID_SCHEDULE",
      });
    }
  });

  test("preserves stable overlapping-range conflicts from persistence", async () => {
    const repository = makeRepository();
    repository.insertSchedule = async () => {
      throw new BranchScheduleError("SCHEDULE_RANGE_OVERLAP");
    };
    const service = new BranchScheduleService(repository, { async assertCanManageBranch() {} });

    await expect(service.createSchedule({ accountId: 7 }, command)).rejects.toMatchObject({
      code: "SCHEDULE_RANGE_OVERLAP",
    });
  });

  test("returns no schedule and gives an override precedence", async () => {
    const repository = makeRepository();
    repository.findApplicableSchedule = async () => undefined;
    const service = new BranchScheduleService(repository, { async assertCanManageBranch() {} });

    await expect(service.findApplicableSchedule({ accountId: 7 }, 10, "2026-09-09")).resolves.toEqual({
      kind: "none",
    });

    repository.findOverride = async () => override;
    await expect(service.findApplicableSchedule({ accountId: 7 }, 10, "2026-09-10")).resolves.toEqual({
      kind: "override",
      override,
    });
  });

  test("requires closed overrides to omit hours and open overrides to provide valid hours", async () => {
    const service = new BranchScheduleService(makeRepository(), {
      async assertCanManageBranch() {},
    });

    for (const invalid of [
      { branchId: 10, scheduleDate: "2026-09-10", isClosed: true, workStartTime: "09:00:00" },
      { branchId: 10, scheduleDate: "2026-09-10", isClosed: false, workStartTime: "09:00:00" },
      { branchId: 10, scheduleDate: "2026-09-10", isClosed: false, workStartTime: "18:00:00", closeTime: "09:00:00" },
    ]) {
      await expect(service.upsertOverride({ accountId: 7 }, invalid)).rejects.toMatchObject({
        code: "INVALID_OVERRIDE_HOURS",
      });
    }
  });

  test("allows a closed override and writes the authenticated actor", async () => {
    const repository = makeRepository();
    const service = new BranchScheduleService(repository, { async assertCanManageBranch() {} });

    await service.upsertOverride({ accountId: 7 }, {
      branchId: 10,
      scheduleDate: "2026-09-10",
      isClosed: true,
    });

    expect(repository.lastOverrideCommand).toMatchObject({
      branchId: 10,
      isClosed: true,
      createdByUserAccountId: 7,
    });
  });
});
