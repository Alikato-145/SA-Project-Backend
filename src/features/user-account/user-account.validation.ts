import { t } from "elysia";

/**
 * Transport validation only. Credential validity and account state remain service
 * concerns so the route cannot reveal whether a username exists.
 */
export const loginRequestSchema = t.Object(
  {
    username: t.String({ minLength: 1, maxLength: 100 }),
    password: t.String({ minLength: 1, maxLength: 1_024 }),
  },
  { additionalProperties: false },
);
