import type { FastifyRequest } from "fastify";
import { AppError } from "../../lib/errors/index.js";
import type { AuthContext } from "../auth/auth.types.js";
import type { RequestMeta } from "./organization.service.js";

/**
 * Resolves the authenticated context attached by the `authenticate`
 * preHandler. Throws a client-safe 401 when absent (defense in depth — the
 * preHandler should already have guarded the route).
 */
export function systemAuthContext(request: FastifyRequest): AuthContext {
  if (!request.auth) {
    throw AppError.unauthorized();
  }
  return request.auth;
}

/** Request metadata captured for audit events. */
export function requestMeta(request: FastifyRequest): RequestMeta {
  const userAgent = request.headers["user-agent"];
  return {
    requestId: request.id,
    ipAddress: request.ip ?? null,
    userAgent: typeof userAgent === "string" ? userAgent : null,
  };
}
