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
  actorFromContext(context: unknown): ScheduleActor | Promise<ScheduleActor>;
};

/**
 * Person C composes this plugin below `/api` after supplying authenticated actor
 * context and the shared error boundary. It deliberately has no app-level import.
 */
export const createBranchScheduleRoutes = (dependencies: BranchScheduleRouteDependencies) =>
  new Elysia({ name: "branch-schedule" })
    .get("/branch-schedules/applicable", async (context) =>
      dependencies.controller.findApplicable({
        actor: await dependencies.actorFromContext(context),
        branchId: (context.query as { branchId: string }).branchId,
        workDate: (context.query as { workDate: string }).workDate,
      }),
    )
    .get("/branch-schedules", async (context) =>
      dependencies.controller.list({
        actor: await dependencies.actorFromContext(context),
        branchId: (context.query as { branchId: string }).branchId,
        workDate: (context.query as { workDate?: string }).workDate,
      }),
    )
    .post("/branch-schedules", async (context) =>
      dependencies.controller.create({
        actor: await dependencies.actorFromContext(context),
        command: context.body as CreateBranchScheduleCommand,
      }),
    )
    .patch("/branch-schedules/:id", async (context) =>
      dependencies.controller.update({
        actor: await dependencies.actorFromContext(context),
        id: (context.params as { id: string }).id,
        command: context.body as UpdateBranchScheduleCommand,
      }),
    )
    .put("/branch-schedules/:branchId/overrides/:date", async (context) =>
      dependencies.controller.upsertOverride({
        actor: await dependencies.actorFromContext(context),
        branchId: (context.params as { branchId: string }).branchId,
        scheduleDate: (context.params as { date: string }).date,
        command: context.body as Omit<UpsertScheduleOverrideCommand, "branchId" | "scheduleDate">,
      }),
    );
