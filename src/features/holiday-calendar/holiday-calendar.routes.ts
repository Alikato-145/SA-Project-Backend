import Elysia from "elysia";
import type { CreateHolidayCommand, HolidayActor, UpdateHolidayCommand } from "./holiday-calendar.dto";
import { HolidayCalendarController } from "./holiday-calendar.controller";

export type HolidayCalendarRouteDependencies = { controller: HolidayCalendarController; actorFromContext(context: unknown): HolidayActor | Promise<HolidayActor> };

export const createHolidayCalendarRoutes = (dependencies: HolidayCalendarRouteDependencies) =>
  new Elysia({ name: "holiday-calendar" })
    .get("/holiday-calendars", async (context) => dependencies.controller.list({
      actor: await dependencies.actorFromContext(context),
      shopId: (context.query as { shopId: string }).shopId,
      holidayDate: (context.query as { holidayDate?: string }).holidayDate,
      activeOnly: (context.query as { activeOnly?: boolean }).activeOnly,
    }))
    .post("/holiday-calendars", async (context) => dependencies.controller.create({
      actor: await dependencies.actorFromContext(context), command: context.body as CreateHolidayCommand,
    }))
    .patch("/holiday-calendars/:id", async (context) => dependencies.controller.update({
      actor: await dependencies.actorFromContext(context), id: (context.params as { id: string }).id,
      command: context.body as UpdateHolidayCommand,
    }));
