import { app } from "./app";
import { appConfig } from "./core/config/aqpp.config";

app.listen({
  hostname: appConfig.elysiaHost,
  port: appConfig.elysiaPort,
});

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
);
