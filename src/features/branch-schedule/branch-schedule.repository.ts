import { ApplicationError } from "../../core/errors/application.error";
import type {
  BranchSchedule,
  BranchScheduleOverride,
  CreateBranchScheduleCommand,
  UpdateBranchScheduleCommand,
  UpsertScheduleOverrideCommand,
} from "./branch-schedule.dto";
import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { operationExecutor, operationTransaction } from "../../core/db/operation-context";
import {
  branchScheduleOverrides,
  branchSchedules,
} from "./branch-schedule.schema";

export type BranchScheduleRepository = {
  createSuccessor?(existing:BranchSchedule,command:CreateBranchScheduleCommand):Promise<BranchSchedule>;
  insertSchedule(command: CreateBranchScheduleCommand): Promise<BranchSchedule>;
  findScheduleById(id: number): Promise<BranchSchedule | undefined>;
  listSchedules(branchId: number, workDate?: string): Promise<BranchSchedule[]>;
  updateSchedule(id: number, command: UpdateBranchScheduleCommand): Promise<BranchSchedule | undefined>;
  findApplicableSchedule(branchId: number, workDate: string): Promise<BranchSchedule | undefined>;
  findOverride(branchId: number, scheduleDate: string): Promise<BranchScheduleOverride | undefined>;
  upsertOverride(
    command: UpsertScheduleOverrideCommand & { createdByUserAccountId: number },
  ): Promise<BranchScheduleOverride>;
};

export type RepositoryErrorCode =
  | "SCHEDULE_RANGE_OVERLAP"
  | "SCHEDULE_OVERRIDE_EXISTS"
  | "INVALID_SCHEDULE";

export class BranchScheduleError extends ApplicationError {
  constructor(
    public readonly code:
      | RepositoryErrorCode
      | "INVALID_OVERRIDE_HOURS"
      | "SCHEDULE_NOT_FOUND"
      | "OUT_OF_SCOPE",
  ) {
    super(code);
    this.name = "BranchScheduleError";
  }
}

const databaseCode = (error: unknown) => {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as { code?: unknown; cause?: { code?: unknown } };
  return typeof candidate.code === "string"
    ? candidate.code
    : typeof candidate.cause?.code === "string"
      ? candidate.cause.code
      : undefined;
};

const translateDatabaseError = (error: unknown): never => {
  switch (databaseCode(error)) {
    case "23P01":
      throw new BranchScheduleError("SCHEDULE_RANGE_OVERLAP");
    case "23505":
      throw new BranchScheduleError("SCHEDULE_OVERRIDE_EXISTS");
    case "23514":
      throw new BranchScheduleError("INVALID_SCHEDULE");
    default:
      throw error;
  }
};

export class DrizzleBranchScheduleRepository implements BranchScheduleRepository {
 async createSuccessor(existing:BranchSchedule,command:CreateBranchScheduleCommand) {
  return operationTransaction(async()=>{
   const close=new Date(`${command.effectiveFrom}T00:00:00Z`); close.setUTCDate(close.getUTCDate()-1);
   await operationExecutor().update(branchSchedules).set({effectiveTo:close.toISOString().slice(0,10),updatedAt:new Date()}).where(eq(branchSchedules.id,existing.id));
   return this.insertSchedule({branchId:command.branchId,workStartTime:command.workStartTime,standardCloseTime:command.standardCloseTime,lateGraceMinutes:command.lateGraceMinutes,effectiveFrom:command.effectiveFrom,effectiveTo:command.effectiveTo});
  });
 }

  async insertSchedule(command: CreateBranchScheduleCommand): Promise<BranchSchedule> {
    try {
      const [schedule] = await operationExecutor().insert(branchSchedules).values(command).returning();
      return schedule;
    } catch (error) {
      return translateDatabaseError(error);
    }
  }

  async findScheduleById(id: number): Promise<BranchSchedule | undefined> {
    return operationExecutor().query.branchSchedules.findFirst({ where: eq(branchSchedules.id, id) });
  }

  async listSchedules(branchId: number, workDate?: string): Promise<BranchSchedule[]> {
    return operationExecutor().query.branchSchedules.findMany({
      where: workDate
        ? and(
            eq(branchSchedules.branchId, branchId),
            lte(branchSchedules.effectiveFrom, workDate),
            or(isNull(branchSchedules.effectiveTo), gte(branchSchedules.effectiveTo, workDate)),
          )
        : eq(branchSchedules.branchId, branchId),
    });
  }

  async updateSchedule(
    id: number,
    command: UpdateBranchScheduleCommand,
  ): Promise<BranchSchedule | undefined> {
    try {
      const [schedule] = await operationExecutor()
        .update(branchSchedules)
        .set({ ...command, updatedAt: new Date() })
        .where(eq(branchSchedules.id, id))
        .returning();
      return schedule;
    } catch (error) {
      return translateDatabaseError(error);
    }
  }

  async findApplicableSchedule(branchId: number, workDate: string): Promise<BranchSchedule | undefined> {
    return operationExecutor().query.branchSchedules.findFirst({
      where: and(
        eq(branchSchedules.branchId, branchId),
        lte(branchSchedules.effectiveFrom, workDate),
        or(isNull(branchSchedules.effectiveTo), gte(branchSchedules.effectiveTo, workDate)),
      ),
    });
  }

  async findOverride(branchId: number, scheduleDate: string): Promise<BranchScheduleOverride | undefined> {
    return operationExecutor().query.branchScheduleOverrides.findFirst({
      where: and(
        eq(branchScheduleOverrides.branchId, branchId),
        eq(branchScheduleOverrides.scheduleDate, scheduleDate),
      ),
    });
  }

  async upsertOverride(
    command: UpsertScheduleOverrideCommand & { createdByUserAccountId: number },
  ): Promise<BranchScheduleOverride> {
    try {
      const existing = await this.findOverride(command.branchId, command.scheduleDate);
      if (existing) {
        const [override] = await operationExecutor()
          .update(branchScheduleOverrides)
          .set({
            isClosed: command.isClosed,
            workStartTime: command.workStartTime ?? null,
            closeTime: command.closeTime ?? null,
            reason: command.reason ?? null,
            updatedAt: new Date(),
          })
          .where(eq(branchScheduleOverrides.id, existing.id))
          .returning();
        return override;
      }
      const [override] = await operationExecutor().insert(branchScheduleOverrides).values(command).returning();
      return override;
    } catch (error) {
      return translateDatabaseError(error);
    }
  }
}
