import { env } from "./env.config";

export const authConfig = Object.freeze({
  jwtSecret: env.AUTH_JWT_SECRET,
  allowedOrigins: env.AUTH_ALLOWED_ORIGINS,
  environment: env.NODE_ENV,
  secureCookies: env.NODE_ENV === "production",
  sessionTtlSeconds: env.AUTH_SESSION_TTL_SECONDS,
  maxFailedAttempts: env.AUTH_MAX_FAILED_ATTEMPTS,
  lockDurationSeconds: env.AUTH_LOCK_DURATION_SECONDS,
});
