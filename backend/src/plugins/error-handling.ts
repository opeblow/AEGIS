import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  AppError,
  INTERNAL_SERVER_ERROR_MESSAGE,
} from "../lib/errors/index.js";
import type { ApiErrorBody } from "../types/api-error.js";

interface FastifyErrorWithStatus extends Error {
  statusCode?: number;
  code?: string;
  validation?: unknown;
  statusMessage?: string;
}

const PRISMA_ERROR_NAMES = new Set([
  "PrismaClientKnownRequestError",
  "PrismaClientUnknownRequestError",
  "PrismaClientRustPanicError",
  "PrismaClientInitializationError",
  "PrismaClientValidationError",
]);

function isDatabaseError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (PRISMA_ERROR_NAMES.has(error.name) ||
      (error as { code?: string }).code === "DATABASE_ERROR")
  );
}

function isNotFound(error: FastifyErrorWithStatus): boolean {
  return error.statusCode === 404 || error.code === "FST_ERR_NOT_FOUND";
}

/**
 * Maps a Prisma `PrismaClientKnownRequestError` onto a client-safe HTTP
 * status/code. Without this, a constraint violation (e.g. a duplicate unique
 * key) surfaces as a generic 500 DATABASE_ERROR even though it is a normal,
 * client-actionable conflict.
 */
function mapPrismaKnownError(
  error: FastifyErrorWithStatus,
): { statusCode: number; code: string; message: string } | null {
  if (error.name !== "PrismaClientKnownRequestError") return null;
  switch (error.code) {
    case "P2002":
      return {
        statusCode: 409,
        code: "CONFLICT",
        message: "The request conflicts with an existing record.",
      };
    case "P2003":
    case "P2014":
      return {
        statusCode: 409,
        code: "CONFLICT",
        message: "The request conflicts with a related record.",
      };
    case "P2025":
      return {
        statusCode: 404,
        code: "NOT_FOUND",
        message: "Resource not found.",
      };
    case "P2000":
    case "P2005":
    case "P2006":
    case "P2007":
    case "P2011":
    case "P2012":
    case "P2013":
    case "P2019":
    case "P2023":
      return {
        statusCode: 400,
        code: "VALIDATION_ERROR",
        message: "The request contains an invalid value.",
      };
    default:
      return null;
  }
}

function normalizeValidationDetails(error: FastifyErrorWithStatus): unknown {
  if (Array.isArray(error.validation)) {
    return error.validation.map((entry) => {
      const instance = entry as {
        instancePath?: string;
        keyword?: string;
        message?: string;
        params?: Record<string, unknown>;
      };
      return {
        path: instance.instancePath ?? "/",
        keyword: instance.keyword ?? "unknown",
        message: instance.message ?? "Invalid value.",
      };
    });
  }
  return error.validation ?? undefined;
}

function buildErrorBody(
  code: string,
  message: string,
  requestId: string,
): ApiErrorBody {
  return { error: { code, message, requestId } };
}

/**
 * Centralized error handling. Every response — including 404s for unknown
 * routes — is serialized to the standard `{ error: { code, message,
 * requestId } }` envelope. Unexpected/database errors are logged in full but
 * reported to the client only in generic terms.
 */
export default fp(
  async function errorHandlingPlugin(app: FastifyInstance): Promise<void> {
    app.setErrorHandler(
      async (
        error: FastifyErrorWithStatus,
        request: FastifyRequest,
        reply: FastifyReply,
      ): Promise<FastifyReply> => {
        const requestId = request.id;

        // Known application error — honor its intended client visibility.
        if (error instanceof AppError) {
          const body: ApiErrorBody = {
            error: {
              code: error.code,
              message: error.expose
                ? error.message
                : INTERNAL_SERVER_ERROR_MESSAGE,
              requestId,
              ...(error.expose && error.details !== undefined
                ? { details: error.details }
                : {}),
            },
          };
          if (!error.expose) {
            request.log.error({ err: error }, `app error code=${error.code}`);
          }
          if (error.statusCode >= 500) {
            reply.log.error({ err: error }, "error reply");
          }
          return reply.status(error.statusCode).send(body);
        }

        if (isNotFound(error)) {
          return reply
            .status(404)
            .send(buildErrorBody("NOT_FOUND", "Route not found.", requestId));
        }

        // Fastify/Zod schema validation failures.
        if (Array.isArray(error.validation) || error.validation !== undefined) {
          return reply.status(error.statusCode ?? 400).send({
            error: {
              code: "VALIDATION_ERROR",
              message: error.message ?? "The request failed validation.",
              requestId,
              details: normalizeValidationDetails(error),
            },
          } satisfies ApiErrorBody);
        }

        if (
          error.code === "FST_ERR_CTP_INVALID_JSON_BODY" ||
          error.code === "FST_ERR_CTP_EMPTY_JSON_BODY"
        ) {
          return reply
            .status(400)
            .send(
              buildErrorBody(
                "VALIDATION_ERROR",
                "The request body is invalid.",
                requestId,
              ),
            );
        }

        // Rate limiting (per-IP / per-route throttles).
        if (error.statusCode === 429 || error.code === "FST_ERR_RATE_LIMITED") {
          return reply
            .status(429)
            .send(
              buildErrorBody(
                "RATE_LIMITED",
                "Too many requests. Please try again later.",
                requestId,
              ),
            );
        }

        // Known Prisma constraint errors map onto their real 4xx semantics
        // (duplicate key -> 409, missing record -> 404, bad value -> 400).
        const prismaMapped = mapPrismaKnownError(error);
        if (prismaMapped) {
          request.log.warn(
            { err: error, prismaCode: error.code },
            "prisma request error mapped to client error",
          );
          return reply
            .status(prismaMapped.statusCode)
            .send(
              buildErrorBody(
                prismaMapped.code,
                prismaMapped.message,
                requestId,
              ),
            );
        }

        // Database layer errors — never leak Prisma internals to clients.
        if (isDatabaseError(error)) {
          request.log.error({ err: error }, "database error");
          return reply
            .status(500)
            .send(
              buildErrorBody(
                "DATABASE_ERROR",
                "A database error occurred. Please try again.",
                requestId,
              ),
            );
        }

        // Everything else — unexpected, do not expose internals.
        request.log.error({ err: error }, "unhandled error");
        return reply
          .status(500)
          .send(
            buildErrorBody(
              "INTERNAL_SERVER_ERROR",
              INTERNAL_SERVER_ERROR_MESSAGE,
              requestId,
            ),
          );
      },
    );

    app.setNotFoundHandler((request, reply) =>
      reply
        .status(404)
        .send(buildErrorBody("NOT_FOUND", "Route not found.", request.id)),
    );
  },
  {
    name: "aegis/error-handling",
    dependencies: ["aegis/request-id"],
  },
);
