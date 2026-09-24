import type { FastifyServerOptions } from "fastify";
import { getEnv } from "../config/env.js";

/**
 * Masks raw invitation tokens that legitimately appear in request URLs
 * (GET /api/v1/invitations/:token). The base64url token is replaced with a
 * placeholder so correlation logs never persist the credential.
 */
function redactInvitationTokensInUrl(url: string): string {
  return url.replace(
    /(\/api\/v1\/invitations\/)[A-Za-z0-9_-]+/g,
    "$1[REDACTED]",
  );
}

/**
 * Pino serializer for the incoming-request log line. Only safe, debugging-
 * friendly fields are exposed — auth headers and invitation tokens are never
 * serialized.
 */
function serializeReq(req: {
  id: string;
  method: string;
  url: string;
}): Record<string, unknown> {
  return {
    requestId: req.id,
    method: req.method,
    url: redactInvitationTokensInUrl(req.url),
  };
}

function serializeRes(res: { statusCode: number }): Record<string, unknown> {
  return { statusCode: res.statusCode };
}

const SENSITIVE_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-api-key"]',
  'req.headers["x-auth-token"]',
  'req.headers["x-access-token"]',
  // Auth payload fields — passwords and raw tokens must never reach logs.
  "password",
  "currentPassword",
  "token",
  "rawToken",
  "csrfToken",
  "passwordHash",
  "tokenHash",
];

/**
 * Fastify logger options with structured output, requestId on every line,
 * and redaction of anything that could carry credentials. Used by both the
 * server bootstrap and tests (which can override `level` via env).
 */
export function createLoggerOptions(): FastifyServerOptions {
  const env = getEnv();
  return {
    logger: {
      level: env.LOG_LEVEL,
      redact: {
        paths: SENSITIVE_PATHS,
        censor: "[REDACTED]",
      },
      serializers: {
        req: serializeReq,
        res: serializeRes,
      },
      base: {
        service: "aegis-backend",
        environment: env.NODE_ENV,
      },
    },
  };
}
