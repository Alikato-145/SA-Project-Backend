import type { ErrorCode } from "../../core/errors/error-codes";

export interface SuccessHttpDto<T, TMeta = never> {
  data: T;
  meta?: TMeta;
  request_id: string;
}

export interface PublicErrorDto {
  code: ErrorCode;
  message: string;
  field_errors?: Readonly<Record<string, readonly string[]>>;
  retry_at?: string;
}

export interface ErrorHttpDto {
  error: PublicErrorDto;
  request_id: string;
}
