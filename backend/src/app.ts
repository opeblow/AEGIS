import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";
import { createLoggerOptions } from "./lib/logger.js";
import { genRequestId } from "./lib/request-id.js";
import requestIdPlugin from "./plugins/request-id.js";
import securityPlugin from "./plugins/security.js";
import errorHandlingPlugin from "./plugins/error-handling.js";
import routes from "./routes/index.js";
import authPlugin from "./modules/auth/auth.plugin.js";

export interface BuildAppOptions {
  /** Override logger for tests (e.g. disable logging noise). */
  logger?: FastifyServerOptions["logger"];
  bodyLimit?: number;
}

/**
 * Builds the configured Fastify application.
 *
 * The application is fully wired here (plugins, security, routing, error
 * handling) WITHOUT binding a socket, which is what makes it possible to
 * exercise routes live in integration tests via `app.inject()`. Starting the
 * HTTP listener is the sole responsibility of `server.ts`.
 */
export async function buildApp(
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const baseOptions = createLoggerOptions();

  const app = Fastify({
    ...baseOptions,
    bodyLimit: options.bodyLimit ?? 1_000_000, // default 1 MB request body cap
    logger: options.logger ?? baseOptions.logger,
    genReqId: genRequestId,
    logController: new LogController({
      requestIdLogLabel: "requestId",
    }),
    trustProxy: true,
  });

  // Plugins
  await app.register(requestIdPlugin);
  await app.register(errorHandlingPlugin);
  await app.register(securityPlugin);
  await app.register(authPlugin);

  // Routes under /api/v1
  await app.register(routes);

  // Root compatibility route: proof-of-life, no application logic.
  app.get("/", async () => ({
    name: "aegis-backend",
    version: "0.1.0",
    health: "/api/v1/health",
  }));

  return app;
}
