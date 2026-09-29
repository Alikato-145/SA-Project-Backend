import type { AuthenticatedActor } from "./auth.types";
import { ApplicationError } from "../errors/application.error";

export type OperationActor = { accountId: number; trustedActor?: AuthenticatedActor; requestId?: string };
export const operationActor = (actor: AuthenticatedActor, requestId: string) => {
  const accountId = Number(actor.accountId);
  if (!Number.isSafeInteger(accountId) || accountId < 1) throw new ApplicationError("AUTH_REQUIRED");
  return { accountId, trustedActor: actor, requestId, scope: "self" as "self" | "department" | "branch" | "all" };
};
