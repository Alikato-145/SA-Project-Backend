import { expect, test } from "bun:test";
import { app } from "./app";

test("application root mounts the A3 employee bundle behind authentication", async () => {
  expect((await app.handle(new Request("http://test/api/v1/employees"))).status).toBe(401);
});
