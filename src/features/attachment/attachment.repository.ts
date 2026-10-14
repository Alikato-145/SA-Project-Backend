import { desc, eq } from "drizzle-orm";
import type { DatabaseExecutor } from "../../core/db/transaction";
import { attachments } from "./attachment.schema";
import { databaseId } from "../../shared/operation-validation";
export type AttachmentOwner = { kind: "employee" | "leave"; id: string };
export type AttachmentRecord = typeof attachments.$inferSelect;
export const attachmentRepository = {
  list: (executor: DatabaseExecutor, owner: AttachmentOwner) => executor.select().from(attachments)
    .where(eq(owner.kind === "employee" ? attachments.employeeId : attachments.leaveRequestId, databaseId(owner.id))).orderBy(desc(attachments.uploadedAt), desc(attachments.id)),
  async find(executor: DatabaseExecutor, id: string) {
    const [record] = await executor.select().from(attachments).where(eq(attachments.id, databaseId(id))).limit(1);
    return record ?? null;
  },
  async insert(executor: DatabaseExecutor, input: typeof attachments.$inferInsert) {
    const [record] = await executor.insert(attachments).values(input).returning(); return record!;
  },
};
