import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

const REQUEST_ID_HEADER = "x-request-id";

/**
 * Threads the request/correlation id into every response header. The id
 * itself is assigned by the `genReqId` configured in app.ts (honoring a safe
 * `x-request-id` from the client, else a fresh UUID). This plugin only echoes
 * it back so callers can correlate responses to server logs.
 */
export default fp(
  async function requestIdPlugin(app: FastifyInstance): Promise<void> {
    app.addHook("onSend", async (request, reply) => {
      void reply.header(REQUEST_ID_HEADER, request.id);
    });
  },
  {
    name: "aegis/request-id",
  },
);
