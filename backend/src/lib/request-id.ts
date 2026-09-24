import { randomUUID } from "node:crypto";

const REQUEST_ID_HEADER = "x-request-id";
const MAX_REQUEST_ID_LENGTH = 128;
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]+$/;

/**
 * Request ID generation for Fastify's native `genReqId`.
 *
 * Clients may pass a correlation ID in `x-request-id`; we honor it only when
 * it is short and made of safe characters so it can never be abused for log
 * injection or oversized-header attacks. Anything else gets a fresh UUIDv4.
 */
export function genRequestId(req: {
  headers: Record<string, unknown>;
}): string {
  const header = req.headers[REQUEST_ID_HEADER];
  if (typeof header === "string") {
    const value = header.trim();
    if (
      value.length > 0 &&
      value.length <= MAX_REQUEST_ID_LENGTH &&
      SAFE_REQUEST_ID.test(value)
    ) {
      return value;
    }
  }
  return randomUUID();
}
