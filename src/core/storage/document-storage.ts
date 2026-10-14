import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { ApplicationError } from "../errors/application.error";

export const documentSha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const createDocumentStorage = (root = process.env.DOCUMENT_STORAGE_PATH ?? ".data/documents") => {
  const base = resolve(root);
  const filePath = (key: string) => {
    if (!/^[A-Za-z0-9_./-]+$/.test(key) || key.split("/").some((part) => !part || part === "." || part === "..")) throw new ApplicationError("VALIDATION_ERROR");
    const path = resolve(base, key);
    if (!path.startsWith(base + sep)) throw new ApplicationError("VALIDATION_ERROR");
    return path;
  };
  return {
    async put(key: string, bytes: Uint8Array) {
      const path = filePath(key);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      try { await writeFile(path, bytes, { flag: "wx", mode: 0o600 }); }
      catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
        if (documentSha256(await readFile(path)) !== documentSha256(bytes)) throw new ApplicationError("STATE_CONFLICT");
      }
      return { sha256: documentSha256(bytes), size: bytes.byteLength };
    },
    async read(key: string, expectedSha256: string) {
      let bytes: Buffer;
      try { bytes = await readFile(filePath(key)); }
      catch { throw new ApplicationError("RESOURCE_NOT_FOUND", { publicMessage: "ไม่พบไฟล์เอกสาร กรุณาติดต่อผู้ดูแลระบบ" }); }
      if (documentSha256(bytes) !== expectedSha256) throw new ApplicationError("STATE_CONFLICT", { publicMessage: "ไฟล์เอกสารไม่ตรงกับหลักฐานที่บันทึกไว้" });
      return bytes;
    },
  };
};
export type DocumentStorage = ReturnType<typeof createDocumentStorage>;
