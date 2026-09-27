const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type MutationRequestRejection =
  | "ORIGIN_NOT_ALLOWED"
  | "JSON_CONTENT_TYPE_REQUIRED";

export interface MutationRequestValidation {
  allowed: boolean;
  rejection?: MutationRequestRejection;
}

const toCanonicalOrigin = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (
      url.origin === "null" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
};

export const isCookieMutationMethod = (method: string): boolean =>
  unsafeMethods.has(method.toUpperCase());

export const isExactAllowedOrigin = (
  origin: string | null,
  allowedOrigins: readonly string[],
): boolean => {
  if (!origin || origin === "null") return false;

  const requestOrigin = toCanonicalOrigin(origin);
  if (!requestOrigin) return false;

  return allowedOrigins.some(
    (allowedOrigin) =>
      toCanonicalOrigin(allowedOrigin) === requestOrigin,
  );
};

export const isJsonContentType = (contentType: string | null): boolean => {
  if (!contentType) return false;
  return contentType.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
};

/**
 * Validates login, logout, and every other cookie-authenticated mutation.
 * Safe methods and preflight requests are intentionally outside this boundary.
 */
export const validateCookieMutationRequest = (
  request: Request,
  allowedOrigins: readonly string[],
): MutationRequestValidation => {
  if (!isCookieMutationMethod(request.method)) return { allowed: true };

  if (!isExactAllowedOrigin(request.headers.get("origin"), allowedOrigins)) {
    return { allowed: false, rejection: "ORIGIN_NOT_ALLOWED" };
  }

  if (!isJsonContentType(request.headers.get("content-type"))) {
    return { allowed: false, rejection: "JSON_CONTENT_TYPE_REQUIRED" };
  }

  return { allowed: true };
};
