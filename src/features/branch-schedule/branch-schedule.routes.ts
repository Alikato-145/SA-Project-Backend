import Elysia from "elysia";
import type {
  CreateBranchScheduleCommand,
  ScheduleActor,
  UpdateBranchScheduleCommand,
  UpsertScheduleOverrideCommand,
} from "./branch-schedule.dto";
import { BranchScheduleController } from "./branch-schedule.controller";

export type BranchScheduleRouteDependencies = {
  controller: BranchScheduleController;
  actorFromContext(context: unknown): ScheduleActor;
};

/**
 * Person C composes this plugin below `/api` after supplying authenticated actor
 * context and the shared error boundary. It deliberately has no app-level import.
 */
export const createBranchScheduleRoutes = (dependencies: BranchScheduleRouteDependencies) =>
  new Elysia({ name: "branch-schedule" })
    .get("/branch-schedules/applicable", (context) =>
      dependencies.controller.findApplicable({
        actor: dependencies.actorFromContext(context),
        branchId: (context.query as { branchId: string }).branchId,
        workDate: (context.query as { workDate: string }).workDate,
      }),
    )
    .get("/branch-schedules", (context) =>
      dependencies.controller.list({
        actor: dependencies.actorFromContext(context),
        branchId: (context.query as { branchId: string }).branchId,
        workDate: (context.query as { workDate?: string }).workDate,
      }),
    )
    .post("/branch-schedules", (context) =>
      dependencies.controller.create({
        actor: dependencies.actorFromContext(context),
        command: context.body as CreateBranchScheduleCommand,
      }),
    )
    .patch("/branch-schedules/:id", (context) =>
      dependencies.controller.update({
        actor: dependencies.actorFromContext(context),
        id: (context.params as { id: string }).id,
        command: context.body as UpdateBranchScheduleCommand,
      }),
    )
    .put("/branch-schedules/:branchId/overrides/:date", (context) =>
      dependencies.controller.upsertOverride({
        actor: dependencies.actorFromContext(context),
        branchId: (context.params as { branchId: string }).branchId,
        scheduleDate: (context.params as { date: string }).date,
        command: context.body as Omit<UpsertScheduleOverrideCommand, "branchId" | "scheduleDate">,
      }),
    );
