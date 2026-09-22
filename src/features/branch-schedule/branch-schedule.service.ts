import type {
  ApplicableSchedule,
  BranchSchedule,
  BranchScheduleOverride,
  CreateBranchScheduleCommand,
  ScheduleActor,
  UpdateBranchScheduleCommand,
  UpsertScheduleOverrideCommand,
} from "./branch-schedule.dto";
import {
  BranchScheduleError,
  type BranchScheduleRepository,
} from "./branch-schedule.repository";

export type BranchScheduleAccess = {
  assertCanManageBranch(actor: ScheduleActor, branchId: number): Promise<void>;
};

const hasCompleteHours = (start?: string | null, close?: string | null) =>
  Boolean(start) && Boolean(close) && start! < close!;

export class BranchScheduleService {
  constructor(
    private readonly repository: BranchScheduleRepository,
    private readonly access: BranchScheduleAccess,
  ) {}

  async createSchedule(actor: ScheduleActor, command: CreateBranchScheduleCommand): Promise<BranchSchedule> {
    await this.access.assertCanManageBranch(actor, command.branchId);
    this.assertSchedule(command);
    return this.repository.insertSchedule(command);
  }

  async updateSchedule(
    actor: ScheduleActor,
    id: number,
    command: UpdateBranchScheduleCommand,
  ): Promise<BranchSchedule> {
    const existing = await this.requireSchedule(id);
    await this.access.assertCanManageBranch(actor, existing.branchId);
    this.assertSchedule({ ...existing, ...command });
    return (await this.repository.updateSchedule(id, command)) ?? this.notFound();
  }

  async listSchedules(
    actor: ScheduleActor,
    branchId: number,
    workDate?: string,
  ): Promise<BranchSchedule[]> {
    await this.access.assertCanManageBranch(actor, branchId);
    return this.repository.listSchedules(branchId, workDate);
  }

  async findApplicableSchedule(
    actor: ScheduleActor,
    branchId: number,
    workDate: string,
  ): Promise<ApplicableSchedule> {
    await this.access.assertCanManageBranch(actor, branchId);
    const override = await this.repository.findOverride(branchId, workDate);
    if (override) return { kind: "override", override };
    const schedule = await this.repository.findApplicableSchedule(branchId, workDate);
    return schedule ? { kind: "schedule", schedule } : { kind: "none" };
  }

  async upsertOverride(
    actor: ScheduleActor,
    command: UpsertScheduleOverrideCommand,
  ): Promise<BranchScheduleOverride> {
    await this.access.assertCanManageBranch(actor, command.branchId);
    this.assertOverride(command);
    return this.repository.upsertOverride({ ...command, createdByUserAccountId: actor.accountId });
  }

  private async requireSchedule(id: number) {
    const schedule = await this.repository.findScheduleById(id);
    return schedule ?? this.notFound();
  }

  private assertSchedule(command: CreateBranchScheduleCommand) {
    if (
      command.lateGraceMinutes < 0 ||
      command.standardCloseTime <= command.workStartTime ||
      (command.effectiveTo !== null && command.effectiveTo !== undefined && command.effectiveTo < command.effectiveFrom)
    ) {
      throw new BranchScheduleError("INVALID_SCHEDULE");
    }
  }

  private assertOverride(command: UpsertScheduleOverrideCommand) {
    if (command.isClosed && (command.workStartTime || command.closeTime)) {
      throw new BranchScheduleError("INVALID_OVERRIDE_HOURS");
    }
    if (!command.isClosed && !hasCompleteHours(command.workStartTime, command.closeTime)) {
      throw new BranchScheduleError("INVALID_OVERRIDE_HOURS");
    }
  }

  private notFound(): never {
    throw new BranchScheduleError("SCHEDULE_NOT_FOUND");
  }
}
