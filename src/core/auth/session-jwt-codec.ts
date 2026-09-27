import { SignJWT, jwtVerify } from "jose";
import type { SessionJwtCodec } from "./auth.types";

/**
 * Production codec for the session service. The service remains responsible
 * for claim shape and lifetime; this adapter only signs and verifies HS256.
 */
export const createSessionJwtCodec = (secret: string): SessionJwtCodec => {
  const key = new TextEncoder().encode(secret);

  return {
    sign({ sub, exp }) {
      return new SignJWT({ sub })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime(exp)
        .sign(key);
    },
    async verify(token) {
      if (!token) return false;

      try {
        return (await jwtVerify(token, key, { algorithms: ["HS256"] })).payload;
      } catch {
        return false;
      }
    },
  };
};
