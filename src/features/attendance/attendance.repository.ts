import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../../core/db/client";
import type {
  CorrectWorkDayCommand,
  CreateManualWorkDayCommand,
  WorkDayRangeFilter,
  WorkDayRecord,
} from "./attendance.dto";
import { workDayRecords } from "./attendance.schema";

export type AttendanceRepository = {
  insert(command: CreateManualWorkDayCommand & { entrySource: "manual"; createdByUserAccountId: number }): Promise<WorkDayRecord>;
  findById(id: number): Promise<WorkDayRecord | undefined>;
  updateCorrectable(id: number, command: CorrectWorkDayCommand): Promise<WorkDayRecord | undefined>;
  findForPayrollRange(filter: WorkDayRangeFilter): Promise<WorkDayRecord[]>;
};

export class AttendanceError extends Error {
  constructor(public readonly code: "WORK_DAY_ALREADY_EXISTS" | "INVALID_CLOCK_RANGE" | "ATTENDANCE_NOT_FOUND" | "OUT_OF_SCOPE" | "PAYROLL_PERIOD_LOCKED" | "INVALID_ATTENDANCE" | "ATTENDANCE_LEAVE_CONFLICT" | "ATTENDANCE_ASSIGNMENT_NOT_FOUND" | "ATTENDANCE_LEAVE_REQUIRES_APPROVAL") {
    super(code);
    this.name = "AttendanceError";
  }
}

const databaseCode = (error: unknown) => {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as { code?: unknown; cause?: { code?: unknown } };
  return typeof candidate.code === "string" ? candidate.code : candidate.cause?.code;
};

export class DrizzleAttendanceRepository implements AttendanceRepository {
  async insert(command: CreateManualWorkDayCommand & { entrySource: "manual"; createdByUserAccountId: number }): Promise<WorkDayRecord> {
    try {
      const [record] = await db.insert(workDayRecords).values(command).returning();
      return record;
    } catch (error) {
      if (databaseCode(error) === "23505") throw new AttendanceError("WORK_DAY_ALREADY_EXISTS");
      if (databaseCode(error) === "23514") throw new AttendanceError("INVALID_CLOCK_RANGE");
      throw error;
    }
  }

  async findById(id: number): Promise<WorkDayRecord | undefined> {
    return db.query.workDayRecords.findFirst({ where: eq(workDayRecords.id, id) });
  }

  async updateCorrectable(id: number, command: CorrectWorkDayCommand): Promise<WorkDayRecord | undefined> {
    try {
      const [record] = await db
        .update(workDayRecords)
        .set({ ...command, updatedAt: new Date() })
        .where(and(eq(workDayRecords.id, id), sql`${workDayRecords.status} <> 'leave'`))
        .returning();
      return record;
    } catch (error) {
      if (databaseCode(error) === "23514") throw new AttendanceError("INVALID_CLOCK_RANGE");
      throw error;
    }
  }

  async findForPayrollRange(filter: WorkDayRangeFilter): Promise<WorkDayRecord[]> {
    const conditions = [gte(workDayRecords.workDate, filter.startDate), lte(workDayRecords.workDate, filter.endDate)];
    if (filter.employeeId !== undefined) conditions.push(eq(workDayRecords.employeeId, filter.employeeId));
    if (filter.branchId !== undefined) conditions.push(eq(workDayRecords.branchId, filter.branchId));
    return db.query.workDayRecords.findMany({ where: and(...conditions) });
  }
}
