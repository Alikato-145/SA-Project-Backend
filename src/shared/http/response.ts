export type ApiSuccess<T> = {
  ok: true;
  data: T;
};

export type ApiErrorDetails = Record<string, unknown>;

export type ApiError = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: ApiErrorDetails;
  };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export const success = <T>(data: T): ApiSuccess<T> => ({ ok: true, data });

export const publicError = (
  code: string,
  message: string,
  details?: ApiErrorDetails,
): ApiError => ({
  ok: false,
  error: {
    code,
    message,
    ...(details ? { details } : {}),
  },
});
