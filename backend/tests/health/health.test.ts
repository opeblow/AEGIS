import { describe, expect, it, vi, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";

const mocks = vi.hoisted(() => ({
  isDatabaseReachable: vi.fn<() => Promise<boolean>>(),
}));

vi.mock("../../src/lib/prisma.js", () => ({
  isDatabaseReachable: mocks.isDatabaseReachable,
}));

describe("GET /api/v1/health", () => {
  let app: FastifyInstance;

  it("returns 200 with status ok when the app is alive", async () => {
    app = await buildApp({ logger: false });
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  afterEach(async () => {
    await app?.close();
    vi.clearAllMocks();
  });
});

describe("GET /api/v1/health/ready", () => {
  let app: FastifyInstance;

  const setDatabase = (available: boolean) => {
    mocks.isDatabaseReachable.mockResolvedValue(available);
  };

  it("returns 200 with status ok when the database is available", async () => {
    setDatabase(true);
    app = await buildApp({ logger: false });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/health/ready",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      checks: { database: "available" },
    });
  });

  it("returns 503 degraded when the database is unavailable", async () => {
    setDatabase(false);
    app = await buildApp({ logger: false });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/health/ready",
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: "degraded",
      checks: { database: "unavailable" },
    });
  });

  afterEach(async () => {
    await app?.close();
    vi.clearAllMocks();
  });
});
