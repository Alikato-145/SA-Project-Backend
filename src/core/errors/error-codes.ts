export const errorCodes = [
  "MALFORMED_REQUEST",
  "AUTH_REQUIRED",
  "INVALID_CREDENTIALS",
  "ACCOUNT_DISABLED",
  "FORBIDDEN_SCOPE",
  "ORIGIN_NOT_ALLOWED",
  "JSON_CONTENT_TYPE_REQUIRED",
  "RESOURCE_NOT_FOUND",
<<<<<<< Updated upstream
=======
  "DUPLICATE_CODE",
  "DUPLICATE_IDENTITY",
>>>>>>> Stashed changes
  "DUPLICATE_USERNAME",
  "EMPLOYEE_ACCOUNT_ALREADY_EXISTS",
  "DUPLICATE_ROLE_GRANT",
  "STATE_CONFLICT",
  "VALIDATION_ERROR",
  "INVALID_ROLE_SCOPE",
  "INVALID_ORGANIZATION_RELATION",
  "EFFECTIVE_DATE_OVERLAP",
  "PRIMARY_BANK_ACCOUNT_CONFLICT",
  "ACCOUNT_LOCKED",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export const errorStatusByCode = {
  MALFORMED_REQUEST: 400,
  AUTH_REQUIRED: 401,
  INVALID_CREDENTIALS: 401,
  ACCOUNT_DISABLED: 403,
  FORBIDDEN_SCOPE: 403,
  ORIGIN_NOT_ALLOWED: 403,
  JSON_CONTENT_TYPE_REQUIRED: 415,
  RESOURCE_NOT_FOUND: 404,
<<<<<<< Updated upstream
=======
  DUPLICATE_CODE: 409,
  DUPLICATE_IDENTITY: 409,
>>>>>>> Stashed changes
  DUPLICATE_USERNAME: 409,
  EMPLOYEE_ACCOUNT_ALREADY_EXISTS: 409,
  DUPLICATE_ROLE_GRANT: 409,
  STATE_CONFLICT: 409,
  VALIDATION_ERROR: 422,
  INVALID_ROLE_SCOPE: 422,
  INVALID_ORGANIZATION_RELATION: 422,
  EFFECTIVE_DATE_OVERLAP: 409,
  PRIMARY_BANK_ACCOUNT_CONFLICT: 409,
  ACCOUNT_LOCKED: 423,
  INTERNAL_ERROR: 500,
} as const satisfies Record<ErrorCode, number>;

export const errorMessageByCode = {
  MALFORMED_REQUEST: "The request could not be understood.",
  AUTH_REQUIRED: "Authentication is required.",
  INVALID_CREDENTIALS: "The username or password is incorrect.",
  ACCOUNT_DISABLED: "This account is disabled.",
  FORBIDDEN_SCOPE: "You do not have permission to perform this action.",
  ORIGIN_NOT_ALLOWED: "The request origin is not allowed.",
  JSON_CONTENT_TYPE_REQUIRED: "A JSON request body is required.",
  RESOURCE_NOT_FOUND: "The requested resource was not found.",
<<<<<<< Updated upstream
=======
  DUPLICATE_CODE: "That organization code is already in use.",
  DUPLICATE_IDENTITY: "That employee identity is already in use.",
>>>>>>> Stashed changes
  DUPLICATE_USERNAME: "That username is already in use.",
  EMPLOYEE_ACCOUNT_ALREADY_EXISTS: "That employee already has an account.",
  DUPLICATE_ROLE_GRANT: "That role grant already exists.",
  STATE_CONFLICT: "The requested change conflicts with the current state.",
  VALIDATION_ERROR: "The submitted data is invalid.",
  INVALID_ROLE_SCOPE: "The role scope is invalid.",
  INVALID_ORGANIZATION_RELATION: "The organization scope is invalid.",
  EFFECTIVE_DATE_OVERLAP: "The effective dates overlap an existing period.",
  PRIMARY_BANK_ACCOUNT_CONFLICT: "The primary bank account conflicts with the current state.",
  ACCOUNT_LOCKED: "This account is temporarily locked.",
  INTERNAL_ERROR: "An unexpected error occurred.",
} as const satisfies Record<ErrorCode, string>;
