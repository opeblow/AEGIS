import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import {
  listDevMailbox,
  clearDevMailbox,
} from "../../src/modules/auth/email.service.js";

async function isDatabaseReachable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

const dbUp = await isDatabaseReachable();

describe.skipIf(!dbUp)("auth API (integration)", () => {
  let app: FastifyInstance;

  const emails: string[] = [];

  const now = Date.now();
  const uniqueEmail = (prefix: string): string => {
    const email = `it.${prefix}.${now}.${emails.length}@example.com`;
    emails.push(email);
    return email;
  };

  const PASSWORD = "Correct-Horse-2017-Staple!";

  beforeEach(() => clearDevMailbox());

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    // Cascade-delete leaves sessions/verifications/resets/events behind.
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await app?.close();
    await prisma.$disconnect();
  });

  function cookieHeader(res: {
    cookies: Array<{ name: string; value: string }>;
  }): string {
    return res.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  async function register(email: string, password = PASSWORD) {
    return app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email, password },
    });
  }

  async function verificationTokenFor(email: string): Promise<string> {
    const message = listDevMailbox().find(
      (m) => m.kind === "EMAIL_VERIFICATION" && m.toNormalized === email,
    );
    expect(message).toBeDefined();
    return message!.token;
  }

  async function login(email: string, password = PASSWORD) {
    return app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password },
    });
  }

  describe("account creation", () => {
    it("registers, sends a verification email, and hides secrets", async () => {
      const email = uniqueEmail("register");
      const response = await register(email);
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.user.email).toBe(email);
      expect(body.user.emailVerified).toBe(false);
      expect(body.user.passwordHash).toBeUndefined();
      expect(body.user.status).toBe("ACTIVE");
      // Verification challenge was created + mailed.
      const token = await verificationTokenFor(email);
      expect(token.length).toBeGreaterThan(20);
    });

    it("rejects duplicate emails with a 409 CONFLICT", async () => {
      const email = uniqueEmail("dup");
      await register(email);
      const second = await register(email);
      expect(second.statusCode).toBe(409);
      expect(second.json()).toMatchObject({
        error: { code: "CONFLICT" },
      });
    });

    it("rejects a too-short password with a validation error", async () => {
      const response = await register(uniqueEmail("short"), "12345");
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("email verification", () => {
    it("verifies with a valid token and refuses to reuse it", async () => {
      const email = uniqueEmail("verify");
      await register(email);
      const token = await verificationTokenFor(email);

      const first = await app.inject({
        method: "POST",
        url: "/api/v1/auth/verify-email",
        payload: { token },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json().user.emailVerified).toBe(true);

      const second = await app.inject({
        method: "POST",
        url: "/api/v1/auth/verify-email",
        payload: { token },
      });
      expect(second.statusCode).toBe(400);
      expect(second.json().error.code).toBe("VALIDATION_ERROR");
    });

    it("returns a generic error for an unknown token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/verify-email",
        payload: { token: "a".repeat(43) },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("authentication", () => {
    it("rejects unknown-email and wrong-password logins identically", async () => {
      const wrongResponse = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: uniqueEmail("ghost"), password: PASSWORD },
      });
      expect(wrongResponse.statusCode).toBe(401);
      const ghostBody = wrongResponse.json();

      const email = uniqueEmail("loginfail");
      await register(email);
      const badPw = await login(email, "Not-The-Password-123!");
      expect(badPw.statusCode).toBe(401);

      const badPwBody = badPw.json();
      expect(ghostBody.error.code).toBe(badPwBody.error.code);
      expect(ghostBody.error.message).toBe(badPwBody.error.message);
    });

    it("logs in and issues an HttpOnly session cookie plus a CSRF token", async () => {
      const email = uniqueEmail("login");
      await register(email);
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/verify-email",
        payload: { token: await verificationTokenFor(email) },
      });

      const response = await login(email);
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.user.email).toBe(email);
      expect(typeof body.csrfToken).toBe("string");

      const sessionCookie = response.cookies.find(
        (c) => c.name === "aegis_session",
      );
      const csrfCookie = response.cookies.find((c) => c.name === "aegis_csrf");
      expect(sessionCookie).toBeDefined();
      expect(csrfCookie).toBeDefined();
      expect(sessionCookie!.httpOnly).toBe(true);
      expect(sessionCookie!.sameSite).toBe("Lax");
      // No HttpOnly -> the CSRF token cookie is readable by client JavaScript.
      expect(csrfCookie!.httpOnly).toBeUndefined();
      // Sessions are revoked server-side through the DB, never via cookie.
      expect(body.csrfToken).toBe(csrfCookie!.value);
    });

    it("returns 401 for a missing or malformed session cookie", async () => {
      const missing = await app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
      });
      expect(missing.statusCode).toBe(401);
      expect(missing.json().error.code).toBe("UNAUTHORIZED");

      const malformed = await app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
        headers: { cookie: "aegis_session=garbage" },
      });
      expect(malformed.statusCode).toBe(401);
    });
  });

  describe("session management", () => {
    async function verifiedAccount(): Promise<{
      email: string;
      jar: string;
      csrf: string;
    }> {
      const email = uniqueEmail("sess");
      await register(email);
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/verify-email",
        payload: { token: await verificationTokenFor(email) },
      });
      const response = await login(email);
      const jar = cookieHeader(response);
      return { email, jar, csrf: response.json().csrfToken };
    }

    it("reads the authenticated identity via /me", async () => {
      const { jar } = await verifiedAccount();
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
        headers: { cookie: jar },
      });
      expect(response.statusCode).toBe(200);
      const { user, session } = response.json();
      expect(user.emailVerified).toBe(true);
      expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(session.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("requires the CSRF header for state changes and honors it", async () => {
      const { jar, csrf } = await verifiedAccount();

      const denied = await app.inject({
        method: "POST",
        url: "/api/v1/auth/change-password",
        headers: { cookie: jar },
        payload: {
          currentPassword: PASSWORD,
          password: "New-Password-2026!!",
        },
      });
      expect(denied.statusCode).toBe(403);
      expect(denied.json().error.code).toBe("FORBIDDEN");

      const allowed = await app.inject({
        method: "POST",
        url: "/api/v1/auth/change-password",
        headers: { cookie: jar, "x-csrf-token": csrf },
        payload: {
          currentPassword: PASSWORD,
          password: "New-Password-2026!!",
        },
      });
      expect(allowed.statusCode).toBe(200);
    });

    it("revokes a specific session and kills its cookie immediately", async () => {
      const { jar, csrf } = await verifiedAccount();
      const sessionsRes = await app.inject({
        method: "GET",
        url: "/api/v1/auth/sessions",
        headers: { cookie: jar },
      });
      const { sessions } = sessionsRes.json();
      expect(sessions.length).toBeGreaterThanOrEqual(1);
      const target = sessions[sessions.length - 1].id;

      const denied = await app.inject({
        method: "DELETE",
        url: `/api/v1/auth/sessions/${target}`,
        headers: { cookie: jar },
      });
      expect(denied.statusCode).toBe(403);

      const revoked = await app.inject({
        method: "DELETE",
        url: `/api/v1/auth/sessions/${target}`,
        headers: { cookie: jar, "x-csrf-token": csrf },
      });
      expect(revoked.statusCode).toBe(200);

      const after = await app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
        headers: { cookie: jar },
      });
      expect(after.statusCode).toBe(401);
    });

    it("logout-all keeps the current session but kills the others", async () => {
      const account = await verifiedAccount();
      const { jar, email, csrf } = account;

      const second = await login(email);
      const jar2 = cookieHeader(second);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/logout-all",
        headers: { cookie: jar, "x-csrf-token": csrf },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().revoked).toBe(1);

      const oldSess = await app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
        headers: { cookie: jar2 },
      });
      expect(oldSess.statusCode).toBe(401);

      const current = await app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
        headers: { cookie: jar },
      });
      expect(current.statusCode).toBe(200);
    });

    it("logs out the current session and clears the session cookie", async () => {
      const { jar, csrf } = await verifiedAccount();
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/logout",
        headers: { cookie: jar, "x-csrf-token": csrf },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().revoked).toBe(true);

      const clearedCookie = response.cookies.find(
        (c) => c.name === "aegis_session",
      );
      expect(clearedCookie).toBeDefined();

      const after = await app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
        headers: { cookie: jar },
      });
      expect(after.statusCode).toBe(401);
    });
  });

  describe("password flows", () => {
    it("enforces the current password when changing", async () => {
      const email = uniqueEmail("chg");
      await register(email);
      const loginRes = await login(email);
      const jar = cookieHeader(loginRes);
      const csrf = loginRes.json().csrfToken;

      const wrong = await app.inject({
        method: "POST",
        url: "/api/v1/auth/change-password",
        headers: { cookie: jar, "x-csrf-token": csrf },
        payload: {
          currentPassword: "Wrong-Current-123!",
          password: "Whatever-2026!!",
        },
      });
      expect(wrong.statusCode).toBe(401);

      const ok = await app.inject({
        method: "POST",
        url: "/api/v1/auth/change-password",
        headers: { cookie: jar, "x-csrf-token": csrf },
        payload: {
          currentPassword: PASSWORD,
          password: "Changed-Password-2026!!",
        },
      });
      expect(ok.statusCode).toBe(200);
    });

    it("completes a forgot -> reset cycle and invalidates old sessions", async () => {
      const email = uniqueEmail("reset");
      await register(email);
      const loginRes = await login(email);
      const jar = cookieHeader(loginRes);

      const forgot = await app.inject({
        method: "POST",
        url: "/api/v1/auth/forgot-password",
        payload: { email },
      });
      expect(forgot.statusCode).toBe(200);

      const resetMessage = listDevMailbox().find(
        (m) => m.kind === "PASSWORD_RESET" && m.toNormalized === email,
      );
      expect(resetMessage).toBeDefined();

      const reset = await app.inject({
        method: "POST",
        url: "/api/v1/auth/reset-password",
        payload: {
          token: resetMessage!.token,
          password: "Reset-Password-2026!!",
        },
      });
      expect(reset.statusCode).toBe(200);
      expect(reset.json().user.email).toBe(email);

      // Old session is dead.
      const oldSess = await app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
        headers: { cookie: jar },
      });
      expect(oldSess.statusCode).toBe(401);

      // Old password dead; new password works.
      const oldPw = await login(email, PASSWORD);
      expect(oldPw.statusCode).toBe(401);
      const newPw = await login(email, "Reset-Password-2026!!");
      expect(newPw.statusCode).toBe(200);

      // Token is single-use.
      const reuse = await app.inject({
        method: "POST",
        url: "/api/v1/auth/reset-password",
        payload: {
          token: resetMessage!.token,
          password: "Reset-Password-2026!!",
        },
      });
      expect(reuse.statusCode).toBe(400);
    });
  });

  describe("brute-force throttling", () => {
    it("rate-limits failed logins per account after the threshold", async () => {
      const email = uniqueEmail("throttle");
      await register(email);

      let saw429 = false;
      for (let attempt = 0; attempt < 8; attempt++) {
        const response = await login(email, `Wrong-${attempt}-123456!!`);
        if (response.statusCode === 429) {
          expect(response.json().error.code).toBe("RATE_LIMITED");
          saw429 = true;
          break;
        }
        expect(response.statusCode).toBe(401);
      }
      expect(saw429).toBe(true);
    });
  });

  describe("security event trail", () => {
    it("records lifecycle events without raw secrets", async () => {
      const email = uniqueEmail("events");
      const registeredAt = new Date();
      await register(email);
      const verify = await app.inject({
        method: "POST",
        url: "/api/v1/auth/verify-email",
        payload: { token: await verificationTokenFor(email) },
      });
      expect(verify.statusCode).toBe(200);

      const events = await prisma.securityEvent.findMany({
        where: {
          user: { email },
          createdAt: { gte: registeredAt },
        },
        orderBy: { createdAt: "asc" },
      });
      const types = events.map((e) => e.type);
      expect(types).toContain("USER_REGISTERED");
      expect(types).toContain("EMAIL_VERIFICATION_REQUESTED");
      expect(types).toContain("EMAIL_VERIFIED");
      for (const event of events) {
        const serialized = JSON.stringify(event);
        expect(serialized).not.toContain(PASSWORD);
        expect(serialized).not.toContain("passwordHash");
      }
    });
  });

  describe("development mailbox API", () => {
    it("lists sends and can be cleared", async () => {
      const email = uniqueEmail("mailbox");
      await register(email);
      const list = await app.inject({
        method: "GET",
        url: "/api/v1/auth/dev/mailbox",
      });
      expect(list.statusCode).toBe(200);
      expect(list.json().messages.length).toBeGreaterThan(0);
      expect(JSON.stringify(list.json())).not.toContain("Correct-Horse-2017");

      const tokens = await app.inject({
        method: "GET",
        url: "/api/v1/auth/dev/mailbox/tokens",
      });
      expect(tokens.statusCode).toBe(200);
      const tokenEntry = tokens
        .json()
        .messages.find(
          (m: { kind: string; to: string }) =>
            m.kind === "EMAIL_VERIFICATION" && m.to === email,
        );
      expect(tokenEntry?.token).toBeTypeOf("string");

      const cleared = await app.inject({
        method: "DELETE",
        url: "/api/v1/auth/dev/mailbox",
      });
      expect(cleared.statusCode).toBe(200);
      expect(listDevMailbox()).toHaveLength(0);
    });
  });
});
