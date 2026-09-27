import { describe, expect, test } from "bun:test";
import type { DatabaseExecutor } from "../db/transaction";
import type { AuditEvent, AuditEventWriter, AuditReceipt } from "../../features/audit/audit.repository";
import { createActionContext } from "./action-context";
import { ActionObserver, markFailureAsAudited } from "./action-observer";
import { DomainAuditObserver } from "./domain-audit-observer";

const executor = {} as DatabaseExecutor;
const context = createActionContext({
  requestId: "request-1",
  actorAccountId: "1",
  actionBase: "employee.profile.view",
  target: { tableName: "employees", recordId: "2" },
});

class MemoryWriter implements AuditEventWriter {
  events: AuditEvent[] = [];
  fail = false;
  async insert(_executor: DatabaseExecutor, event: AuditEvent): Promise<AuditReceipt> {
    if (this.fail) throw new Error("store unavailable");
    this.events.push(event);
    return { id: this.events.length, action: event.action, requestId: event.requestId };
  }
}

describe("action observer", () => {
  test("audits a read before disclosing its value", async () => {
    const writer = new MemoryWriter();
    const observer = new ActionObserver(executor, writer);
    expect(await observer.observeRead(context, async () => "safe result")).toBe("safe result");
    expect(writer.events.map(({ action }) => action)).toEqual(["employee.profile.view.succeeded"]);
  });

  test("records a stable failure and preserves the original error", async () => {
    const writer = new MemoryWriter();
    const observer = new ActionObserver(executor, writer);
    const original = Object.assign(new Error("private detail"), { code: "FORBIDDEN_SCOPE" });
    expect(observer.observeRead(context, async () => { throw original; })).rejects.toBe(original);
    await Promise.resolve();
    expect(writer.events).toHaveLength(1);
    expect(writer.events[0]?.reason).toBe("FORBIDDEN_SCOPE");
    expect(JSON.stringify(writer.events[0])).not.toContain("private detail");
  });

  test("uses the transactional domain row as the only mutation success row", async () => {
    const writer = new MemoryWriter();
    const observer = new ActionObserver(executor, writer);
    const domain = new DomainAuditObserver(writer);
    const result = await observer.observeMutation(context, async () => {
      const receipt = await domain.record(executor, context, { newData: { id: "2" } });
      return domain.complete("done", receipt);
    });
    expect(result).toBe("done");
    expect(writer.events).toHaveLength(1);
  });

  test("does not duplicate an intentionally committed failed mutation audit", async () => {
    const writer = new MemoryWriter();
    const observer = new ActionObserver(executor, writer);
    const error = markFailureAsAudited(Object.assign(new Error("denied"), { code: "INVALID_CREDENTIALS" }));
    await expect(observer.observeMutation(context, async () => { throw error; })).rejects.toBe(error);
    expect(writer.events).toHaveLength(0);
  });

  test("preserves the original error when failure audit persistence is unavailable", async () => {
    const writer = new MemoryWriter();
    writer.fail = true;
    const fallback: { message: string; requestId: string; action: string }[] = [];
    const observer = new ActionObserver(executor, writer, { error: (event) => fallback.push(event) });
    const original = new Error("business failed");
    await expect(observer.observeRead(context, async () => { throw original; })).rejects.toBe(original);
    expect(fallback).toEqual([{
      message: "Persistent audit unavailable",
      requestId: "request-1",
      action: "employee.profile.view.failed",
    }]);
  });
});

