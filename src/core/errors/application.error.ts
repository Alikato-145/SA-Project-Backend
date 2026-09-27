import {
  errorMessageByCode,
  errorStatusByCode,
  type ErrorCode,
} from "./error-codes";

export type FieldErrors = Readonly<Record<string, readonly string[]>>;

export interface ApplicationErrorOptions {
  cause?: unknown;
  fieldErrors?: FieldErrors;
  retryAt?: string;
}

export class ApplicationError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fieldErrors?: FieldErrors;
  readonly retryAt?: string;

  constructor(code: ErrorCode, options: ApplicationErrorOptions = {}) {
    super(errorMessageByCode[code], { cause: options.cause });
    this.name = "ApplicationError";
    this.code = code;
    this.status = errorStatusByCode[code];
    this.fieldErrors = options.fieldErrors;
    this.retryAt = options.retryAt;
  }
}

export const isApplicationError = (error: unknown): error is ApplicationError =>
  error instanceof ApplicationError;
