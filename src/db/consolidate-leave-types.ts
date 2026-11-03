import { and, eq, inArray, sql } from "drizzle-orm";
import { db, closeDatabase } from "../core/db/client";
import { leaveApprovalActions, leaveQuotas, leaveRequestDays, leaveRequests, leaveTypes } from "../features/leave/leave.schema";
import { userAccounts } from "../features/user-account/user-account.schema";
import { sameLeavePolicy } from "./leave-consolidation";

// This one-time cleanup applies only to known demo codes. Preserve historical decisions.
const groups = [
  { keep: "HARIS-SICK", old: ["DEMO_SICK", "MOCK26_SICK", "HDEMO26_SICK"] },
  { keep: "HARIS-PERSONAL", old: ["DEMO_PERSONAL", "MOCK26_PERSONAL", "HDEMO26_PERSONAL"] },
  { keep: "HARIS-ANNUAL", old: ["DEMO_ANNUAL", "MOCK26_ANNUAL", "HDEMO26_ANNUAL"] },
  { keep: "DEMO_UNPAID", old: ["MOCK26_UNPAID", "HDEMO26_UNPAID"] },
];

async function consolidate() {
  if (process.env.CONFIRM_LEAVE_CONSOLIDATION !== "1") throw new Error("Explicit cleanup confirmation is required");
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(73012603)`);
    const [actor] = await tx.select().from(userAccounts).where(eq(userAccounts.username, "haris_owner"));
    if (!actor) throw new Error("Presentation owner is required for the audit trail");
    let typesArchived = 0, quotasMoved = 0, pendingUpdated = 0;
    for (const group of groups) {
      const rows = await tx.select().from(leaveTypes).where(inArray(leaveTypes.code, [group.keep, ...group.old])).for("update");
      const canonical = rows.find((row) => row.code === group.keep && row.isActive);
      if (!canonical) throw new Error(`Active canonical type missing: ${group.keep}`);
      for (const old of rows.filter((row) => row.code !== group.keep && row.isActive)) {
        if (!sameLeavePolicy(old, canonical)) throw new Error(`Different policy, refusing to merge: ${old.code}`);
        const quotas = await tx.select().from(leaveQuotas).where(eq(leaveQuotas.leaveTypeId, old.id)).for("update");
        for (const q of quotas) {
          const [clash] = await tx.select().from(leaveQuotas).where(and(eq(leaveQuotas.employeeId, q.employeeId), eq(leaveQuotas.quotaYear, q.quotaYear), eq(leaveQuotas.leaveTypeId, canonical.id)));
          if (clash) throw new Error(`Duplicate quota for employee ${q.employeeId}, year ${q.quotaYear}; no changes applied`);
          await tx.update(leaveQuotas).set({ leaveTypeId: canonical.id, updatedAt: new Date() }).where(eq(leaveQuotas.id, q.id));
          quotasMoved++;
        }
        const pending = await tx.select().from(leaveRequests).where(and(eq(leaveRequests.originalLeaveTypeId, old.id), eq(leaveRequests.status, "pending"))).for("update");
        for (const request of pending) {
          await tx.execute(sql`select pg_advisory_xact_lock(${request.employeeId})`);
          await tx.insert(leaveApprovalActions).values({ leaveRequestId: request.id, actorUserAccountId: actor.id, action: "overridden", fromLeaveTypeId: old.id, toLeaveTypeId: canonical.id, remark: "รวมประเภทลาที่มีกฎเดียวกัน โดยคงวันที่และสิทธิ์เดิม" });
          await tx.update(leaveRequests).set({ originalLeaveTypeId: canonical.id, updatedAt: new Date() }).where(eq(leaveRequests.id, request.id));
          await tx.update(leaveRequestDays).set({ leaveTypeId: canonical.id, updatedAt: new Date() }).where(eq(leaveRequestDays.leaveRequestId, request.id));
          pendingUpdated++;
        }
        await tx.update(leaveTypes).set({ isActive: false, updatedAt: new Date() }).where(eq(leaveTypes.id, old.id));
        typesArchived++;
      }
    }
    console.log(JSON.stringify({ typesArchived, quotasMoved, pendingUpdated }));
  });
}
try { await consolidate(); } finally { await closeDatabase(); }
