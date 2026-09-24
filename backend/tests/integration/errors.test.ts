import { describe, expect, it, vi, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { AppError } from "../../src/lib/errors/index.js";
import { z, validateBody } from "../../src/lib/validation.js";

describe("centralized error handling", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
    vi.clearAllMocks();
  });

  it("returns the standardized envelope and a request id for unknown routes", async () => {
    app = await buildApp({ logger: false });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/does-not-exist",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: {
        code: "NOT_FOUND",
        message: "Route not found.",
      },
    });
    expect(typeof response.json().error.requestId).toBe("string");
    expect(response.json().error.requestId.length).toBeGreaterThan(0);
    expect(response.headers["x-request-id"]).toBeDefined();
  });

  it("masks unexpected errors and never leaks internals", async () => {
    app = await buildApp({ logger: false });
    app.get("/boom", async () => {
      throw new Error("config_pw: hunter2");
    });

    const response = await app.inject({ method: "GET", url: "/boom" });

    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(body.error.message).toContain("unexpected error");
    expect(JSON.stringify(body)).not.toContain("hunter2");
    expect(JSON.stringify(body)).not.toContain("config_pw");
  });

  it("serializes AppError with its stable code, message and details", async () => {
    app = await buildApp({ logger: false });
    app.post(
      "/validate",
      {
        preHandler: validateBody(
          z.object({
            name: z.string().min(3),
          }),
        ),
      },
      async (request) => {
        return { ok: true, body: request.body };
      },
    );

    const response = await app.inject({
      method: "POST",
      url: "/validate",
      payload: { name: "x" },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.requestId).toBeDefined();
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(body.error.details[0]).toMatchObject({
      path: "name",
      code: "too_small",
    });
  });

  it("returns a proper message for explicit not-found AppError", async () => {
    app = await buildApp({ logger: false });
    app.get("/missing-thing", async () => {
      throw AppError.notFound("Deal not found.");
    });

    const response = await app.inject({ method: "GET", url: "/missing-thing" });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toMatchObject({
      code: "NOT_FOUND",
      message: "Deal not found.",
    });
  });
});
