import { z, type ZodType, type ZodError } from "zod";
import type { FastifyRequest } from "fastify";
import { AppError } from "./errors/index.js";

export { z };

function formatIssues(error: ZodError): Array<{
  path: string;
  message: string;
  code: string;
}> {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Central validation helper. Parses an arbitrary value against a Zod schema
 * and converts failures into the standardized `VALIDATION_ERROR` AppError so
 * the centralized error handler serializes them consistently.
 */
export function validate<S extends z.ZodType>(
  schema: S,
  value: unknown,
  context = "payload",
): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw AppError.validation(
      `Invalid ${context}: ${result.error.issues[0]?.message ?? "invalid value"}.`,
      formatIssues(result.error),
    );
  }
  return result.data;
}

/**
 * Fastify route preHandler building blocks. Each returns a handler that
 * validates the corresponding request part against a Zod schema and redirects
 * failures into the AppError pipeline.
 */
export function validateQuery<T>(schema: ZodType<T>) {
  return (request: FastifyRequest): T =>
    validate(schema, request.query, "query");
}

export function validateParams<T>(schema: ZodType<T>) {
  return (request: FastifyRequest): T =>
    validate(schema, request.params, "params");
}

export function validateBody<T>(schema: ZodType<T>) {
  return (request: FastifyRequest): T => validate(schema, request.body, "body");
}
