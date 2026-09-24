import type { FastifyInstance, FastifyPluginCallback } from "fastify";
import { z } from "../../lib/validation.js";
import { isDatabaseReachable } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors/index.js";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
});

export const readyResponseSchema = z.object({
  status: z.literal("ok").or(z.literal("degraded")),
  checks: z.object({
    database: z.literal("available").or(z.literal("unavailable")),
  }),
});

const healthRoutes: FastifyPluginCallback = (
  app: FastifyInstance,
  _opts,
  done,
): void => {
  /**
   * Liveness probe. Answers without touching infrastructure so that
   * orchestrators can distinguish "process is up" from "process is ready".
   */
  app.get("/health", async () => {
    const body = healthResponseSchema.parse({ status: "ok" });
    return body;
  });

  /**
   * Readiness probe. Verifies the prerequisites the app needs to serve
   * requests — currently the database connection. Returns 503 when the
   * database is unreachable so load balancers can drain the instance.
   */
  app.get("/health/ready", async (_request, reply) => {
    const databaseAvailable = await isDatabaseReachable();

    const body = {
      status: databaseAvailable ? "ok" : "degraded",
      checks: {
        database: databaseAvailable ? "available" : "unavailable",
      },
    } as const;

    const parsed = readyResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.validation(
        "Readiness response failed validation.",
        parsed.error.issues,
      );
    }

    if (!databaseAvailable) {
      return reply.status(503).send(parsed.data);
    }
    return parsed.data;
  });

  done();
};

export default healthRoutes;
