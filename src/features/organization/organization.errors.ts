import { ApplicationError } from "../../core/errors/application.error";

const hasDatabaseCode = (error: unknown, code: string): boolean => {
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== "object" || current === null) return false;
    if ("code" in current && (current as { code?: unknown }).code === code) return true;
    current = "cause" in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
};

export const rethrowOrganizationPersistenceError = (error: unknown): never => {
  if (hasDatabaseCode(error, "23505")) {
    throw new ApplicationError("DUPLICATE_CODE", { cause: error });
  }
  throw error;
};
