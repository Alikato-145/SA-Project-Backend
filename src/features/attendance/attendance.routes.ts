import Elysia from "elysia";
import type { AttendanceActor, CorrectWorkDayCommand, CreateManualWorkDayCommand, WorkDayRangeFilter } from "./attendance.dto";
import { AttendanceController } from "./attendance.controller";

export type AttendanceRouteDependencies = { controller: AttendanceController; actorFromContext(context: unknown): AttendanceActor };

export const createAttendanceRoutes = (dependencies: AttendanceRouteDependencies) =>
  new Elysia({ name: "attendance" })
    .get("/work-day-records", (context) => dependencies.controller.list({
      actor: dependencies.actorFromContext(context), filter: context.query as unknown as WorkDayRangeFilter,
    }))
    .post("/work-day-records", (context) => dependencies.controller.create({
      actor: dependencies.actorFromContext(context), command: context.body as CreateManualWorkDayCommand,
    }))
    .patch("/work-day-records/:id", (context) => dependencies.controller.correct({
      actor: dependencies.actorFromContext(context), id: (context.params as { id: string }).id,
      command: context.body as CorrectWorkDayCommand,
    }));
