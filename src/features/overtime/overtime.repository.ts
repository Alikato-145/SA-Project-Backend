import { ApplicationError } from "../../core/errors/application.error";
import { and, eq, gte, lte } from "drizzle-orm";
import { operationExecutor, operationTransaction } from "../../core/db/operation-context";
import { overtimeApprovalActions, overtimeRecords } from "./overtime.schema";
import type { OvertimeRecord, SubmitOvertimeCommand } from "./overtime.dto";

export class OvertimeError extends ApplicationError {
  constructor(public readonly code:
    | "INVALID_OVERTIME_AMOUNT" | "INVALID_OVERTIME_DATE" | "OVERTIME_CONTEXT_INVALID"
    | "OVERTIME_ALREADY_EXISTS" | "OVERTIME_NOT_FOUND" | "OVERTIME_NOT_PENDING"
    | "OUT_OF_SCOPE" | "PAYROLL_PERIOD_LOCKED") {
    super(code);
    this.name = "OvertimeError";
  }
}
export type OvertimeSession = {
  transaction: unknown;
  insert(command: SubmitOvertimeCommand, actorId: number): Promise<OvertimeRecord>;
  findForUpdate(id: number): Promise<OvertimeRecord | undefined>;
  decide(id: number, decision: "approved" | "rejected"): Promise<OvertimeRecord>;
  appendAction(id: number, actorId: number, action: "submitted" | "approved" | "rejected", remark?: string): Promise<void>;
};
export type OvertimeRepository = {
  withTransaction<T>(work: (session: OvertimeSession) => Promise<T>): Promise<T>;
  listByEmployee(employeeId: number): Promise<OvertimeRecord[]>;
  findApproved(employeeId: number, startDate: string, endDate: string): Promise<OvertimeRecord[]>;
};
const pgCode = (error: unknown) => {
  const value = error as { code?: string; cause?: { code?: string } } | null;
  return value?.code ?? value?.cause?.code;
};
export class DrizzleOvertimeRepository implements OvertimeRepository {
 async findById(id:number) { return operationExecutor().query.overtimeRecords.findFirst({where:eq(overtimeRecords.id,id)}); }
 async history(id:number) { return operationExecutor().query.overtimeApprovalActions.findMany({where:eq(overtimeApprovalActions.overtimeRecordId,id),orderBy:[overtimeApprovalActions.actedAt,overtimeApprovalActions.id]}); }

  async withTransaction<T>(work: (session: OvertimeSession) => Promise<T>): Promise<T> {
    try {
      return await operationTransaction(async (tx) => work({
        transaction: tx,
        insert: async (command, actorId) => {
          const [row] = await tx.insert(overtimeRecords).values({
            employeeId: command.employeeId, overtimeDate: command.overtimeDate,
            overtimeType: command.overtimeType, hours: command.hours ?? null,
            dayUnits: command.dayUnits ?? null, workDayRecordId: command.workDayRecordId ?? null,
            reason: command.reason ?? null, requestedByUserAccountId: actorId,
            status: "pending",
          }).returning();
          return row;
        },
        findForUpdate: async (id) => {
          const [row] = await tx.select().from(overtimeRecords).where(eq(overtimeRecords.id, id)).for("update");
          return row;
        },
        decide: async (id, decision) => {
          const [row] = await tx.update(overtimeRecords).set({
            status: decision, decidedAt: new Date(), updatedAt: new Date(),
          }).where(eq(overtimeRecords.id, id)).returning();
          return row;
        },
        appendAction: async (id, actorId, action, remark) => {
          await tx.insert(overtimeApprovalActions).values({
            overtimeRecordId: id, actorUserAccountId: actorId, action, remark: remark ?? null,
          });
        },
      }));
    } catch (error) {
      if (pgCode(error) === "23505") throw new OvertimeError("OVERTIME_ALREADY_EXISTS");
      if (pgCode(error) === "23514") throw new OvertimeError("INVALID_OVERTIME_AMOUNT");
      throw error;
    }
  }
  async listByEmployee(employeeId: number): Promise<OvertimeRecord[]> {
    return operationExecutor().query.overtimeRecords.findMany({ where: eq(overtimeRecords.employeeId, employeeId) });
  }
  async findApproved(employeeId: number, startDate: string, endDate: string): Promise<OvertimeRecord[]> {
    return operationExecutor().query.overtimeRecords.findMany({ where: and(
      eq(overtimeRecords.employeeId, employeeId),
      eq(overtimeRecords.status, "approved"),
      gte(overtimeRecords.overtimeDate, startDate),
      lte(overtimeRecords.overtimeDate, endDate),
    ) });
  }
}
