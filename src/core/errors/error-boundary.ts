import { randomUUID } from "node:crypto";
import type { ErrorHttpDto } from "../../shared/http/http.dto";
import { ApplicationError, isApplicationError } from "./application.error";

export interface PublicErrorResult {
  status: number;
  body: ErrorHttpDto;
}

export const toPublicErrorResult = (
  error: unknown,
  requestId: string = randomUUID(),
): PublicErrorResult => {
  const applicationError = isApplicationError(error)
    ? error
    : new ApplicationError("INTERNAL_ERROR", { cause: error });

  const body: ErrorHttpDto = {
    error: {
      code: applicationError.code,
      message: applicationError.message,
    },
    request_id: requestId,
  };

  if (applicationError.fieldErrors) {
    body.error.field_errors = applicationError.fieldErrors;
  }
  if (applicationError.retryAt) {
    body.error.retry_at = applicationError.retryAt;
  }

  return { status: applicationError.status, body };
};
