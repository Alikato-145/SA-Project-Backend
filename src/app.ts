import Elysia from "elysia";
import { appConfig } from "./core/config/aqpp.config";

export const app = new Elysia()
  .get("/", () => "Hello Elysia")
  .listen(appConfig.elysiaPort);
