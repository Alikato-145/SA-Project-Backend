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

test("debt and loan endpoints are removed while advance route remains registered", async () => {
  for (const path of ["/debt-types", "/debt-transactions?employee_id=1", "/loans?employee_id=1", "/loan-requests?employee_id=1"]) {
    expect((await app.handle(new Request(`http://localhost/api/v1${path}`))).status).toBe(404);
  }
  expect((await app.handle(new Request("http://localhost/api/v1/advance-requests?employee_id=1"))).status).not.toBe(404);
});
