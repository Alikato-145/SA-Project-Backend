import { describe, expect, test } from "bun:test";
import { jwt } from "@elysiajs/jwt";
import Elysia, { t } from "elysia";
import { SESSION_TTL_SECONDS } from "./auth.types";
import {
  createSessionCookieOptions,
  createSessionTokenService,
} from "./session-token";

const secret = "a-test-secret-that-is-at-least-32-bytes-long";
const issuedAtMs = Date.now();

const createTokenTestApp = (now: () => number) =>
  new Elysia()
    .use(
      jwt({
        name: "sessionJwt",
        secret,
        alg: "HS256",
        schema: t.Object({ sub: t.String() }),
      }),
    )
    .get("/issue", ({ sessionJwt }) =>
      createSessionTokenService(sessionJwt, { now }).issue("42"),
    )
    .post("/verify", async ({ body, sessionJwt }) => {
      const token = (body as { token?: string }).token;
      return {
        claims: await createSessionTokenService(sessionJwt, { now }).verify(token),
      };
    });

describe("session token", () => {
  test("issues a signed token with only sub, iat, and eight-hour exp", async () => {
    const app = createTokenTestApp(() => issuedAtMs);
    const issueResponse = await app.handle(new Request("http://test/issue"));
    const token = await issueResponse.text();

    const verifyResponse = await app.handle(
      new Request("http://test/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      }),
    );
    const responseBody = (await verifyResponse.json()) as {
      claims: Record<string, unknown>;
    };
    const claims = responseBody.claims;

    expect(Object.keys(claims).sort()).toEqual(["exp", "iat", "sub"]);
    expect(claims.sub).toBe("42");
    expect(Number(claims.exp) - Number(claims.iat)).toBe(SESSION_TTL_SECONDS);
  });

  test("rejects tampered and expired tokens", async () => {
    const app = createTokenTestApp(() => issuedAtMs);
    const issueResponse = await app.handle(new Request("http://test/issue"));
    const token = await issueResponse.text();
    const segments = token.split(".");
    const signature = segments[2]!;
    const tamperIndex = Math.floor(signature.length / 2);
    segments[2] = `${signature.slice(0, tamperIndex)}${
      signature[tamperIndex] === "a" ? "b" : "a"
    }${signature.slice(tamperIndex + 1)}`;
    const tampered = segments.join(".");

    const verify = (candidate: string) =>
      app.handle(
        new Request("http://test/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: candidate }),
        }),
      );

    expect(await (await verify(tampered)).json()).toEqual({ claims: null });

    const expiredApp = createTokenTestApp(
      () => issuedAtMs + (SESSION_TTL_SECONDS + 1) * 1_000,
    );
    expect(
      await (
        await expiredApp.handle(
          new Request("http://test/verify", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token }),
          }),
        )
      ).json(),
    ).toEqual({ claims: null });
  });

  test("builds the approved HTTP-only cookie options", () => {
    expect(createSessionCookieOptions("signed.jwt", true)).toEqual({
      value: "signed.jwt",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: true,
      maxAge: SESSION_TTL_SECONDS,
    });
  });
});
