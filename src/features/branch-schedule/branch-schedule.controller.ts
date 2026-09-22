import type {
  CreateBranchScheduleCommand,
  ScheduleActor,
  UpdateBranchScheduleCommand,
  UpsertScheduleOverrideCommand,
} from "./branch-schedule.dto";
import {
  toApplicableScheduleResponse,
  toBranchScheduleOverrideResponse,
  toBranchScheduleResponse,
} from "./branch-schedule.mapper";
import { BranchScheduleError } from "./branch-schedule.repository";
import { BranchScheduleService } from "./branch-schedule.service";

const positiveId = (value: string | number): number => {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new BranchScheduleError("INVALID_SCHEDULE");
  return id;
};

const isoDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BranchScheduleError("INVALID_SCHEDULE");
  return value;
};

export class BranchScheduleController {
  constructor(private readonly service: BranchScheduleService) {}

  async create(input: { actor: ScheduleActor; command: CreateBranchScheduleCommand }) {
    const command = {
      ...input.command,
      branchId: positiveId(input.command.branchId),
      effectiveFrom: isoDate(input.command.effectiveFrom),
      effectiveTo: input.command.effectiveTo ? isoDate(input.command.effectiveTo) : input.command.effectiveTo,
    };
    return toBranchScheduleResponse(await this.service.createSchedule(input.actor, command));
  }

  async list(input: { actor: ScheduleActor; branchId: string | number; workDate?: string }) {
    const branchId = positiveId(input.branchId);
    const workDate = input.workDate ? isoDate(input.workDate) : undefined;
    return (await this.service.listSchedules(input.actor, branchId, workDate)).map(toBranchScheduleResponse);
  }

  async update(input: { actor: ScheduleActor; id: string | number; command: UpdateBranchScheduleCommand }) {
    const command = {
      ...input.command,
      effectiveFrom: input.command.effectiveFrom ? isoDate(input.command.effectiveFrom) : undefined,
      effectiveTo: input.command.effectiveTo ? isoDate(input.command.effectiveTo) : input.command.effectiveTo,
    };
    return toBranchScheduleResponse(await this.service.updateSchedule(input.actor, positiveId(input.id), command));
  }

  async findApplicable(input: { actor: ScheduleActor; branchId: string | number; workDate: string }) {
    return toApplicableScheduleResponse(
      await this.service.findApplicableSchedule(input.actor, positiveId(input.branchId), isoDate(input.workDate)),
    );
  }

  async upsertOverride(input: {
    actor: ScheduleActor;
    branchId: string | number;
    scheduleDate: string;
    command: Omit<UpsertScheduleOverrideCommand, "branchId" | "scheduleDate">;
  }) {
    return toBranchScheduleOverrideResponse(
      await this.service.upsertOverride(input.actor, {
        ...input.command,
        branchId: positiveId(input.branchId),
        scheduleDate: isoDate(input.scheduleDate),
      }),
    );
  }
}
