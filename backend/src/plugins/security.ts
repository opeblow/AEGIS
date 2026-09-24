import fp from "fastify-plugin";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { getEnv, getCorsOrigins } from "../config/env.js";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Security baseline for Phase 1/2: secure HTTP headers (Helmet), configured
 * CORS, per-IP request rate limiting, and (Phase 2) a CSRF origin check.
 */
export default fp(
  async function securityPlugin(app: FastifyInstance): Promise<void> {
    const env = getEnv();
    const corsOrigins = getCorsOrigins();
    // `*` (local development / tests only) is expanded to a reflector because
    // browsers reject `*` in combination with credentials.
    const allowAllOrigins = corsOrigins.includes("*");

    // Secure headers. Disable cross-origin embeddability: this API is for
    // client applications, not <iframe> embedding.
    await app.register(helmet, {
      contentSecurityPolicy: false,
    });

    // CORS. Explicit origins in production (enforced by env validation) with
    // credentials enabled for the auth cookies. `*` is permitted for local
    // development only and, because credentials are enabled, is expanded to a
    // reflector (browsers reject `*` + credentials).
    await app.register(cors, {
      origin: allowAllOrigins ? true : corsOrigins,
      methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Accept",
        "x-request-id",
        "x-csrf-token",
      ],
      exposedHeaders: ["x-request-id"],
      maxAge: 600,
      credentials: true,
    });

    // CSRF origin check — defense in depth for cookie-authenticated
    // state-changing requests. Browser-originated requests must carry an
    // Origin header that matches an allow-listed origin. Non-browser clients
    // (curl, mobile apps) send no Origin, and the session cookie is
    // SameSite=Lax + a synchronizer token guards the remaining risk.
    app.addHook("onRequest", async (request, reply) => {
      if (!MUTATING_METHODS.has(request.method)) return;
      if (env.NODE_ENV === "test") return;
      const origin = request.headers.origin;
      if (!origin) return;
      if (allowAllOrigins) return;
      const allowed = corsOrigins;
      if (Array.isArray(allowed) && allowed.includes(origin)) return;
      return reply.status(403).send({
        error: {
          code: "FORBIDDEN",
          message: "Cross-origin request rejected.",
          requestId: request.id,
        },
      });
    });

    // Conservative per-IP limit. Tuned down for production intentionally —
    // the transaction engine will re-evaluate this once auth exists.
    await app.register(rateLimit, {
      max: 1000,
      timeWindow: "1 minute",
      global: true,
      allowList: (_req, key) =>
        env.NODE_ENV === "test" ? true : key === "127.0.0.1" || key === "::1",
    });
  },
  {
    name: "aegis/security",
  },
);
