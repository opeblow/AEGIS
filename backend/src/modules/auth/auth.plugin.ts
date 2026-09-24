import fp from "fastify-plugin";
import cookie from "@fastify/cookie";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../../lib/errors/index.js";
import authRoutes from "./auth.routes.js";
import { sessionCookieName, csrfCookieName } from "./cookies.js";
import { resolveSessionByToken, touchSession } from "./session.service.js";
import { getUserForAuth } from "./user.service.js";
import {
  toPublicUser,
  toPublicSession,
  type AuthContext,
} from "./auth.types.js";
import { validateCsrfToken } from "./csrf.js";

async function authenticatePreHandler(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const raw = request.cookies[sessionCookieName()];
  if (!raw) throw AppError.unauthorized();

  const session = await resolveSessionByToken(raw);
  if (!session) throw AppError.unauthorized();

  const user = await getUserForAuth(session.userId);

  const context: AuthContext = {
    user: toPublicUser(user),
    session: toPublicSession(session),
    rawSessionRow: session,
    rawUserRow: user,
  };
  request.auth = context;

  // Periodic lastUsedAt refresh (throttled per session).
  void touchSession(session);
}

async function requireCsrfPreHandler(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  // Must run after `authenticate` so request.auth is populated.
  const header = request.headers["x-csrf-token"];
  const headerValue = Array.isArray(header) ? header[0] : header;
  const cookieValue = request.cookies[csrfCookieName()];
  const storedHash = request.auth?.rawSessionRow.csrfTokenHash ?? null;

  if (!validateCsrfToken(headerValue, cookieValue, storedHash)) {
    throw AppError.forbidden();
  }
}

/**
 * Authentication middleware (Phase 2):
 *  - resolves the HttpOnly session cookie into an authenticated context bound
 *    to request.auth (opaque tokens; only hashes are ever persisted),
 *  - exposes the `requireCsrf` companion hook for authenticated state changes,
 *  - registers @fastify/cookie for cookie parsing/setting.
 */
export default fp(
  async function authPlugin(app: FastifyInstance): Promise<void> {
    await app.register(cookie);

    app.decorate("authenticate", authenticatePreHandler);
    app.decorate("requireCsrf", requireCsrfPreHandler);

    await app.register(authRoutes, { prefix: "/api/v1" });
  },
  {
    name: "aegis/auth",
    dependencies: ["aegis/security"],
  },
);
