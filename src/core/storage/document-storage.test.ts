import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDocumentStorage, documentSha256 } from "./document-storage";

test("stored documents reject traversal, replacement and tampering", async () => {
  const root = await mkdtemp(join(tmpdir(), "payroll-doc-"));
  try {
    const storage = createDocumentStorage(root), bytes = Buffer.from("evidence");
    await storage.put("payslips/1.pdf", bytes);
    await storage.put("payslips/1.pdf", bytes);
    expect(await storage.read("payslips/1.pdf", documentSha256(bytes))).toEqual(bytes);
    await expect(storage.read("payslips/missing.pdf", documentSha256(bytes))).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    await expect(storage.put("../secret", bytes)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(storage.put("payslips/1.pdf", Buffer.from("replacement"))).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    await writeFile(join(root, "payslips/1.pdf"), "tampered");
    await expect(storage.read("payslips/1.pdf", documentSha256(bytes))).rejects.toMatchObject({ code: "STATE_CONFLICT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
