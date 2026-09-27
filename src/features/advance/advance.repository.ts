import { and, eq } from "drizzle-orm";
import { db } from "../../core/db/client";
import { advanceRequests } from "./advance.schema";
import type { AdvanceRecord } from "./advance.dto";

export class AdvanceError extends Error {
  constructor(public readonly code:
    | "INVALID_ADVANCE_AMOUNT" | "ADVANCE_INELIGIBLE_DATE"
    | "ADVANCE_WORK_DAYS_INSUFFICIENT" | "ADVANCE_HALF_SALARY_EXCEEDED"
    | "ADVANCE_NEGATIVE_NET_PAY" | "ADVANCE_ALREADY_EXISTS"
    | "ADVANCE_NOT_FOUND" | "ADVANCE_NOT_PENDING" | "OUT_OF_SCOPE") {
    super(code);
    this.name = "AdvanceError";
  }
}
export type AdvanceRepository = {
  insert(command: { employeeId: number; requestMonth: string; amount: string; requestedByUserAccountId: number }): Promise<AdvanceRecord>;
  findById(id: number): Promise<AdvanceRecord | undefined>;
  decide(id: number, status: "approved" | "rejected", actorId: number, note?: string): Promise<AdvanceRecord>;
  listByEmployee(employeeId: number): Promise<AdvanceRecord[]>;
  findApprovedForMonth(employeeId: number, requestMonth: string): Promise<AdvanceRecord[]>;
};
const pgCode = (error: unknown) => {
  const value = error as { code?: string; cause?: { code?: string } } | null;
  return value?.code ?? value?.cause?.code;
};
export class DrizzleAdvanceRepository implements AdvanceRepository {
  async insert(command: Parameters<AdvanceRepository["insert"]>[0]): Promise<AdvanceRecord> {
    try {
      const [row] = await db.insert(advanceRequests).values(command).returning();
      return row;
    } catch (error) {
      if (pgCode(error) === "23505") throw new AdvanceError("ADVANCE_ALREADY_EXISTS");
      throw error;
    }
  }
  async findById(id: number) {
    return db.query.advanceRequests.findFirst({ where: eq(advanceRequests.id, id) });
  }
  async decide(id: number, status: "approved" | "rejected", actorId: number, note?: string): Promise<AdvanceRecord> {
    const [row] = await db.update(advanceRequests).set({
      status, decidedByUserAccountId: actorId, decidedAt: new Date(),
      decisionNote: note ?? null, updatedAt: new Date(),
    }).where(and(eq(advanceRequests.id, id), eq(advanceRequests.status, "pending"))).returning();
    if (!row) throw new AdvanceError("ADVANCE_NOT_PENDING");
    return row;
  }
  async listByEmployee(employeeId: number) {
    return db.query.advanceRequests.findMany({ where: eq(advanceRequests.employeeId, employeeId) });
  }
  async findApprovedForMonth(employeeId: number, requestMonth: string) {
    return db.query.advanceRequests.findMany({ where: and(
      eq(advanceRequests.employeeId, employeeId),
      eq(advanceRequests.requestMonth, requestMonth),
      eq(advanceRequests.status, "approved"),
    ) });
  }
}
