import { expect, test } from "bun:test";
import { validateAttachment } from "./attachment.service";
test("attachment validation checks MIME signatures, path-safe names and size", () => {
  expect(validateAttachment({ name: "test.pdf", mime: "application/pdf", bytes: Buffer.from("%PDF-1.7\n") })).toBe("pdf");
  for (const file of [
    { name: "test.pdf", mime: "application/pdf", bytes: Buffer.from("<script>bad</script>") },
    { name: "../test.pdf", mime: "application/pdf", bytes: Buffer.from("%PDF-") },
    { name: "test.pdf", mime: "application/pdf", bytes: Buffer.alloc(5 * 1024 * 1024 + 1) },
  ]) expect(() => validateAttachment(file)).toThrow();
});
