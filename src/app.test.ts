import { expect, test } from "bun:test";
import { app } from "./app";

test("the application can handle requests without opening a listening socket", async () => {
  const response = await app.handle(new Request("http://localhost/"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    ok: true,
    data: { service: "haris-payroll", status: "ok" },
  });
  expect(app.server).toBeNull();
});
