import { and, eq } from "drizzle-orm";
import { db } from "../../core/db/client";
import { workDayRecords } from "./attendance.schema";
import type { WorkDayRecord } from "./attendance.dto";

export type AttendanceLeaveEffectRepository = {
  findForUpdate(transaction: unknown, employeeId: number, date: string): Promise<WorkDayRecord | undefined>;
  markLeave(transaction: unknown, id: number, deductible: boolean): Promise<void>;
  insertLeave(transaction: unknown, employeeId: number, branchId: number,
    date: string, deductible: boolean): Promise<void>;
};
export class DrizzleAttendanceLeaveEffectRepository implements AttendanceLeaveEffectRepository {
  async findForUpdate(transaction: unknown, employeeId: number, date: string) {
    const tx = transaction as typeof db;
    const [row] = await tx.select().from(workDayRecords).where(and(
      eq(workDayRecords.employeeId, employeeId), eq(workDayRecords.workDate, date),
    )).for("update");
    return row;
  }
  async markLeave(transaction: unknown, id: number, deductible: boolean) {
    const tx = transaction as typeof db;
    await tx.update(workDayRecords).set({ status: "leave", isDeductible: deductible,
      lateMinutes: 0, clockInAt: null, clockOutAt: null, updatedAt: new Date() })
      .where(eq(workDayRecords.id, id));
  }
  async insertLeave(transaction: unknown, employeeId: number, branchId: number,
    date: string, deductible: boolean) {
    const tx = transaction as typeof db;
    await tx.insert(workDayRecords).values({ employeeId, branchId, workDate: date,
      status: "leave", isDeductible: deductible, lateMinutes: 0,
      entrySource: "manual", note: "Approved leave" });
  }
}
