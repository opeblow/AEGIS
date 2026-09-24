import type { FastifyInstance, FastifyPluginCallback } from "fastify";
import { z } from "zod";
import { getEnv } from "../../config/env.js";
import { AppError } from "../../lib/errors/index.js";
import {
  csrfCookieName,
  csrfCookieOptions,
  sessionCookieName,
  sessionCookieOptions,
  clearCookieOptions,
} from "./cookies.js";
import {
  registerBodySchema,
  loginBodySchema,
  verifyEmailBodySchema,
  resendVerificationBodySchema,
  forgotPasswordBodySchema,
  resetPasswordBodySchema,
  changePasswordBodySchema,
  uuidParamSchema,
  type RegisterBody,
  type LoginBody,
  type VerifyEmailBody,
  type ResendVerificationBody,
  type ForgotPasswordBody,
  type ResetPasswordBody,
  type ChangePasswordBody,
} from "./schemas.js";
import * as authService from "./auth.service.js";
import { revokeSession, listSessions } from "./session.service.js";
import { toPublicSession } from "./auth.types.js";
import { recordSecurityEvent, SecurityEventType } from "./security-events.js";
import { listDevMailbox, clearDevMailbox } from "./email.service.js";

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw AppError.validation(
      "The request body is invalid.",
      result.error.issues,
    );
  }
  return result.data;
}

function metaOf(request: {
  ip: string;
  headers: Record<string, string | string[] | undefined>;
}) {
  const ua = request.headers["user-agent"];
  return {
    ipAddress: request.ip,
    userAgent: Array.isArray(ua) ? ua[0] : (ua ?? null),
  };
}

const authRoutes: FastifyPluginCallback = (
  app: FastifyInstance,
  _opts,
  done,
): void => {
  const env = getEnv();
  const sessionTtlSeconds = Math.floor(env.AUTH_SESSION_TTL_MS / 1000);

  // Per-route request throttles (in addition to the global per-IP limit).
  const limits = {
    register: { max: 20, timeWindow: "1 minute" },
    login: { max: 10, timeWindow: "1 minute" },
    resend: { max: 5, timeWindow: "1 minute" },
    forgot: { max: 5, timeWindow: "1 minute" },
    reset: { max: 10, timeWindow: "1 minute" },
    change: { max: 10, timeWindow: "1 minute" },
  } as const;

  /**
   * Create an account. Duplicate emails are a 409 CONFLICT (the UNIQUE
   * database constraint is the source of truth — a raced registration is
   * indistinguishable). Successful registrations receive a verification email.
   */
  app.post(
    "/auth/register",
    { config: { rateLimit: limits.register } },
    async (_request, reply) => {
      const request = _request;
      const body = parseOrThrow(
        registerBodySchema,
        request.body,
      ) as RegisterBody;
      const result = await authService.register({
        email: body.email,
        password: body.password,
        ...metaOf(request),
      });

      if (result.alreadyExists) {
        throw AppError.conflict("An account with this email already exists.");
      }

      await authService.issueEmailVerification(
        result.user.id,
        result.user.email,
        metaOf(request),
      );
      return reply.status(201).send({ user: result.user });
    },
  );

  /**
   * Authenticate and establish a session via HttpOnly cookies. Returns the
   * public user plus the CSRF synchronizer token (also set as a readable
   * cookie) that protected routes require on that session.
   */
  app.post(
    "/auth/login",
    { config: { rateLimit: limits.login } },
    async (_request, reply) => {
      const request = _request;
      const body = parseOrThrow(loginBodySchema, request.body) as LoginBody;
      const result = await authService.login(
        body.email,
        body.password,
        metaOf(request),
      );

      reply.setCookie(
        sessionCookieName(),
        result.rawToken,
        sessionCookieOptions(sessionTtlSeconds),
      );
      reply.setCookie(
        csrfCookieName(),
        result.csrfRawToken,
        csrfCookieOptions(sessionTtlSeconds),
      );
      return { user: result.user, csrfToken: result.csrfRawToken };
    },
  );

  /** Revoke the current session and clear auth cookies. CSRF-protected. */
  app.post(
    "/auth/logout",
    { preHandler: [app.authenticate, app.requireCsrf] },
    async (request, reply) => {
      const raw = request.cookies[sessionCookieName()];
      const before = await authService.logout(raw, metaOf(request));
      reply.clearCookie(sessionCookieName(), clearCookieOptions());
      reply.clearCookie(csrfCookieName(), clearCookieOptions());
      return { message: "Logged out.", revoked: before.revoked };
    },
  );

  /**
   * Revoke every session for the user except the one performing this request
   * (session-takeover remediation). CSRF-protected.
   */
  app.post(
    "/auth/logout-all",
    { preHandler: [app.authenticate, app.requireCsrf] },
    async (request, _reply) => {
      const auth = request.auth;
      if (!auth) throw AppError.unauthorized();
      const revoked = await authService.logoutAll(
        auth.user.id,
        auth.session.id,
        metaOf(request),
      );
      return { message: "Revoked all other sessions.", revoked };
    },
  );

  /** Confirm an email address with a single-use verification token. */
  app.post(
    "/auth/verify-email",
    { config: { rateLimit: limits.resend } },
    async (_request) => {
      const request = _request;
      const body = parseOrThrow(
        verifyEmailBodySchema,
        request.body,
      ) as VerifyEmailBody;
      const user = await authService.verifyEmail(body.token, metaOf(request));
      return { user };
    },
  );

  /** Re-send a verification email. Always returns the same response. */
  app.post(
    "/auth/resend-verification",
    { config: { rateLimit: limits.resend } },
    async (_request) => {
      const request = _request;
      const body = parseOrThrow(
        resendVerificationBodySchema,
        request.body,
      ) as ResendVerificationBody;
      await authService.resendVerification(body.email, metaOf(request));
      return {
        message:
          "If that email is registered and unverified, a verification email has been sent.",
      };
    },
  );

  /** Request a password reset. Always returns the same response. */
  app.post(
    "/auth/forgot-password",
    { config: { rateLimit: limits.forgot } },
    async (_request) => {
      const request = _request;
      const body = parseOrThrow(
        forgotPasswordBodySchema,
        request.body,
      ) as ForgotPasswordBody;
      await authService.forgotPassword(body.email, metaOf(request));
      return {
        message:
          "If that email is registered, a password reset email has been sent.",
      };
    },
  );

  /** Complete a password reset with a single-use token. Invalidates all sessions. */
  app.post(
    "/auth/reset-password",
    { config: { rateLimit: limits.reset } },
    async (_request) => {
      const request = _request;
      const body = parseOrThrow(
        resetPasswordBodySchema,
        request.body,
      ) as ResetPasswordBody;
      const user = await authService.resetPassword(
        body.token,
        body.password,
        metaOf(request),
      );
      return { user };
    },
  );

  /**
   * Change the password while authenticated (requires the current password —
   * OWASP re-auth flow). Revokes every other session. CSRF-protected.
   */
  app.post(
    "/auth/change-password",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.change },
    },
    async (_request, _reply) => {
      const request = _request;
      const auth = request.auth;
      if (!auth) throw AppError.unauthorized();
      const body = parseOrThrow(
        changePasswordBodySchema,
        request.body,
      ) as ChangePasswordBody;
      const result = await authService.changePassword(
        auth.user.id,
        auth.session.id,
        body.currentPassword,
        body.password,
        metaOf(request),
      );
      return {
        message: "Password updated.",
        revokedOthers: result.revokedOthers,
      };
    },
  );

  /** Current authenticated user + session lookup. */
  app.get("/auth/me", { preHandler: [app.authenticate] }, async (request) => {
    const auth = request.auth;
    if (!auth) throw AppError.unauthorized();
    return { user: auth.user, session: auth.session };
  });

  /** List all of the user's sessions (recency order). */
  app.get(
    "/auth/sessions",
    { preHandler: [app.authenticate] },
    async (request) => {
      const auth = request.auth;
      if (!auth) throw AppError.unauthorized();
      const sessions = await listSessions(auth.user.id);
      return { sessions: sessions.map((s) => toPublicSession(s)) };
    },
  );

  /** Revoke one of the user's sessions. CSRF-protected. */
  app.delete(
    "/auth/sessions/:sessionId",
    { preHandler: [app.authenticate, app.requireCsrf] },
    async (_request, _reply) => {
      const request = _request;
      const auth = request.auth;
      if (!auth) throw AppError.unauthorized();
      const { sessionId } = parseOrThrow(uuidParamSchema, request.params);
      const revoked = await revokeSession(sessionId, auth.user.id);
      if (!revoked) {
        throw AppError.notFound("Session not found.");
      }
      await recordSecurityEvent({
        type: SecurityEventType.SESSION_REVOKED,
        userId: auth.user.id,
        metadata: { sessionId },
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] as string | undefined,
      });
      return { message: "Session revoked." };
    },
  );

  // -------------------------------------------------------------------------
  // Development APIs (NEVER available in production).
  // -------------------------------------------------------------------------

  const devOnly = (request: { auth?: unknown }) => {
    if (env.NODE_ENV === "production") {
      throw AppError.forbidden("Not available in production.");
    }
    void request;
  };

  app.get("/auth/dev/mailbox", async (request) => {
    devOnly(request);
    return {
      messages: listDevMailbox().map(({ token: _token, ...rest }) => rest),
    };
  });

  app.get("/auth/dev/mailbox/tokens", async (request) => {
    devOnly(request);
    return {
      messages: listDevMailbox().map((m) => ({
        id: m.id,
        kind: m.kind,
        to: m.toNormalized,
        token: m.token,
      })),
    };
  });

  app.delete("/auth/dev/mailbox", async (request) => {
    devOnly(request);
    clearDevMailbox();
    return { message: "Mailbox cleared." };
  });

  done();
};

export default authRoutes;
