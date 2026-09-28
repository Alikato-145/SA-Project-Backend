import { expect, test } from "bun:test";
import { app } from "../../app";

test("application mounts operations routes behind authentication", async () => {
  const response = await app.handle(new Request("http://localhost/api/v1/operations/leave-requests?employee_id=1"));
  expect(response.status).toBe(401);
  await expect(response.json()).resolves.toMatchObject({ error: { code: "AUTH_REQUIRED" } });
});
