import type { ApprovedLeaveInput } from "../leave/leave.dto";
import type { AttendanceLeaveEffectRepository } from "./attendance-leave-effect.repository";
import { AttendanceError } from "./attendance.repository";

export type AssignmentBranch = {
  branchAtDate(employeeId: number, date: string): Promise<number | undefined>;
};
export class AttendanceLeaveEffect {
  constructor(private readonly repository: AttendanceLeaveEffectRepository,
    private readonly assignment: AssignmentBranch) {}
  async applyApprovedLeave(transaction: unknown, days: ApprovedLeaveInput[]): Promise<void> {
    for (const day of days) {
      const existing = await this.repository.findForUpdate(transaction, day.employeeId, day.date);
      if (existing) {
        if (existing.status !== "absent" && existing.status !== "leave") {
          throw new AttendanceError("ATTENDANCE_LEAVE_CONFLICT");
        }
        await this.repository.markLeave(transaction, existing.id, day.isDeductible);
      } else {
        const branchId = await this.assignment.branchAtDate(day.employeeId, day.date);
        if (!branchId) throw new AttendanceError("ATTENDANCE_ASSIGNMENT_NOT_FOUND");
        await this.repository.insertLeave(transaction, day.employeeId, branchId,
          day.date, day.isDeductible);
      }
    }
  }
}
