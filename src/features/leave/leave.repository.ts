import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "../../core/db/client";
import {
  leaveApprovalActions,
  leaveQuotas,
  leaveRequestDays,
  leaveRequests,
  leaveTypes,
} from "./leave.schema";
import type { LeaveDay, LeaveQuota, LeaveRequest, LeaveType, SubmitLeaveCommand } from "./leave.dto";

export class LeaveError extends Error {
  constructor(public readonly code:
    | "INVALID_LEAVE" | "LEAVE_DATE_OVERLAP" | "LEAVE_TYPE_UNAVAILABLE"
    | "LEAVE_QUOTA_EXCEEDED" | "LEAVE_QUOTA_FROZEN" | "LEAVE_NOT_FOUND"
    | "LEAVE_ALREADY_DECIDED" | "SUPERVISOR_APPROVAL_LIMIT" | "OUT_OF_SCOPE"
    | "PAYROLL_PERIOD_LOCKED") {
    super(code);
    this.name = "LeaveError";
  }
}

type Action = "submitted" | "approved" | "rejected" | "type_changed";
export type LeaveSession = {
  /** Passed to Person C's attendance adapter so its write shares this transaction. */
  transaction: unknown;
  lockEmployee(employeeId: number): Promise<void>;
  findOverlap(employeeId: number, startDate: string, endDate: string, exceptId?: number): Promise<boolean>;
  findType(id: number): Promise<LeaveType | undefined>;
  insertRequest(command: SubmitLeaveCommand, requestedDays: number, actorId: number): Promise<LeaveRequest>;
  insertDays(requestId: number, leaveTypeId: number, dates: string[], deductible: boolean): Promise<void>;
  findRequest(id: number): Promise<LeaveRequest | undefined>;
  findDays(requestId: number): Promise<LeaveDay[]>;
  findQuota(employeeId: number, typeId: number, year: number): Promise<LeaveQuota | undefined>;
  updateQuota(id: number, usedDays: string): Promise<void>;
  updateDay(id: number, typeId: number, paid: boolean, deductible: boolean, consumed: string): Promise<void>;
  decide(id: number, status: "approved" | "rejected", finalTypeId: number | null): Promise<LeaveRequest>;
  appendAction(requestId: number, actorId: number, action: Action, fromTypeId?: number, toTypeId?: number, remark?: string): Promise<void>;
};

export type LeaveRepository = {
  withTransaction<T>(work: (session: LeaveSession) => Promise<T>): Promise<T>;
  listByEmployee(employeeId: number): Promise<LeaveRequest[]>;
  findApprovedDays(employeeId: number, startDate: string, endDate: string): Promise<LeaveDay[]>;
};

const pgCode = (error: unknown): string | undefined => {
  const value = error as { code?: string; cause?: { code?: string } } | null;
  return value?.code ?? value?.cause?.code;
};

export class DrizzleLeaveRepository implements LeaveRepository {
  async withTransaction<T>(work: (session: LeaveSession) => Promise<T>): Promise<T> {
    try {
      return await db.transaction(async (tx) => {
        const session: LeaveSession = {
          transaction: tx,
          lockEmployee: async (employeeId) => {
            await tx.execute(sql`select pg_advisory_xact_lock(${employeeId})`);
          },
          findOverlap: async (employeeId, startDate, endDate, exceptId) => {
            const rows = await tx.select({ id: leaveRequests.id }).from(leaveRequests).where(and(
              eq(leaveRequests.employeeId, employeeId),
              inArray(leaveRequests.status, ["pending", "approved"]),
              lte(leaveRequests.startDate, endDate),
              gte(leaveRequests.endDate, startDate),
              exceptId === undefined ? undefined : sql`${leaveRequests.id} <> ${exceptId}`,
            )).limit(1);
            return rows.length > 0;
          },
          findType: async (id) => tx.query.leaveTypes.findFirst({ where: eq(leaveTypes.id, id) }),
          insertRequest: async (command, requestedDays, actorId) => {
            const [row] = await tx.insert(leaveRequests).values({
              employeeId: command.employeeId,
              originalLeaveTypeId: command.leaveTypeId,
              startDate: command.startDate,
              endDate: command.endDate,
              requestedDays: String(requestedDays),
              reason: command.reason ?? null,
              isRetroactive: command.isRetroactive ?? false,
              submittedByUserAccountId: actorId,
              status: "pending",
            }).returning();
            return row;
          },
          insertDays: async (requestId, typeId, dates, deductible) => {
            await tx.insert(leaveRequestDays).values(dates.map((date) => ({
              leaveRequestId: requestId, leaveDate: date, leaveTypeId: typeId,
              dayAmount: "1", isPaid: !deductible, isDeductible: deductible, quotaConsumed: "0",
            })));
          },
          findRequest: async (id) => {
            const [row] = await tx.select().from(leaveRequests).where(eq(leaveRequests.id, id)).for("update");
            return row;
          },
          findDays: async (id) => tx.query.leaveRequestDays.findMany({ where: eq(leaveRequestDays.leaveRequestId, id) }),
          findQuota: async (employeeId, typeId, year) => {
            const [row] = await tx.select().from(leaveQuotas).where(and(
              eq(leaveQuotas.employeeId, employeeId),
              eq(leaveQuotas.leaveTypeId, typeId),
              eq(leaveQuotas.quotaYear, year),
            )).for("update");
            return row;
          },
          updateQuota: async (id, usedDays) => {
            await tx.update(leaveQuotas).set({ usedDays, updatedAt: new Date() }).where(eq(leaveQuotas.id, id));
          },
          updateDay: async (id, typeId, paid, deductible, consumed) => {
            await tx.update(leaveRequestDays).set({
              leaveTypeId: typeId, isPaid: paid, isDeductible: deductible,
              quotaConsumed: consumed, updatedAt: new Date(),
            }).where(eq(leaveRequestDays.id, id));
          },
          decide: async (id, status, finalTypeId) => {
            const [row] = await tx.update(leaveRequests).set({
              status, finalLeaveTypeId: finalTypeId, decidedAt: new Date(), updatedAt: new Date(),
            }).where(eq(leaveRequests.id, id)).returning();
            return row;
          },
          appendAction: async (requestId, actorId, action, fromTypeId, toTypeId, remark) => {
            await tx.insert(leaveApprovalActions).values({
              leaveRequestId: requestId, actorUserAccountId: actorId, action,
              fromLeaveTypeId: fromTypeId ?? null, toLeaveTypeId: toTypeId ?? null,
              remark: remark ?? null,
            });
          },
        };
        return work(session);
      });
    } catch (error) {
      if (pgCode(error) === "23P01") throw new LeaveError("LEAVE_DATE_OVERLAP");
      throw error;
    }
  }

  async listByEmployee(employeeId: number): Promise<LeaveRequest[]> {
    return db.query.leaveRequests.findMany({ where: eq(leaveRequests.employeeId, employeeId) });
  }

  async findApprovedDays(employeeId: number, startDate: string, endDate: string): Promise<LeaveDay[]> {
    return db.select({
      id: leaveRequestDays.id, leaveRequestId: leaveRequestDays.leaveRequestId,
      workDayRecordId: leaveRequestDays.workDayRecordId, leaveTypeId: leaveRequestDays.leaveTypeId,
      leaveDate: leaveRequestDays.leaveDate, dayAmount: leaveRequestDays.dayAmount,
      isPaid: leaveRequestDays.isPaid, isDeductible: leaveRequestDays.isDeductible,
      quotaConsumed: leaveRequestDays.quotaConsumed,
    }).from(leaveRequestDays).innerJoin(
      leaveRequests, eq(leaveRequestDays.leaveRequestId, leaveRequests.id),
    ).where(and(
      eq(leaveRequests.employeeId, employeeId), eq(leaveRequests.status, "approved"),
      gte(leaveRequestDays.leaveDate, startDate), lte(leaveRequestDays.leaveDate, endDate),
    ));
  }
}
