import Elysia from "elysia";
import { success } from "./shared/http/response";

export const createApp = () =>
  new Elysia({ name: "haris-payroll" }).get("/", () =>
    success({ service: "haris-payroll", status: "ok" }),
  );

// Person C owns this composition root. Feature owners export route plugins;
// registrations are added here without moving feature logic into app.ts.
export const app = createApp();
