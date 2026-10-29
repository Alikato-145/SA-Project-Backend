import { expect, test } from "bun:test";
import { defaultScheduledTimes } from "./attendance-default-clock";
const command = { employeeId: 1, branchId: 2, workDate: "2026-10-01", status: "present" as const, clockInAt: null, clockOutAt: null, lateMinutes: 0, isDeductible: false };
const schedule = { kind: "schedule" as const, schedule: { id: 1, branchId: 2, workStartTime: "09:00:00", standardCloseTime: "18:00:00", lateGraceMinutes: 0, effectiveFrom: "2026-01-01", createdAt: new Date(), updatedAt: new Date() } };
test("fills missing times from Bangkok schedule and marks them as scheduled", () => {
 const result = defaultScheduledTimes(command, schedule);
 expect(result.clockInAt?.toISOString()).toBe("2026-10-01T02:00:00.000Z");
 expect(result.clockOutAt?.toISOString()).toBe("2026-10-01T11:00:00.000Z");
 expect(result.note).toContain("เวลาตามตาราง");
});
test("does not invent times for absence or partially entered times", () => {
 expect(defaultScheduledTimes({...command,status:"absent"}, schedule).clockInAt).toBeNull();
 const actual = new Date("2026-10-01T02:00:00Z");
 expect(defaultScheduledTimes({...command,clockInAt:actual}, schedule).clockOutAt).toBeNull();
});
