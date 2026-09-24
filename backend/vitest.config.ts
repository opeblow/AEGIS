import { defineConfig } from "vitest/config";

/**
 * Tests must be deterministic and must not depend on a real database or any
 * third-party service. We pin a minimal, valid env here and mock the Prisma
 * boundary in the tests themselves.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 15000,
    hookTimeout: 15000,
    restoreMocks: true,
    clearMocks: true,
    env: {
      NODE_ENV: "test",
      PORT: "4000",
      HOST: "127.0.0.1",
      DATABASE_URL:
        "postgresql://postgres:postgres@localhost:5432/aegis_test?schema=public",
      CORS_ORIGIN: "*",
      LOG_LEVEL: "silent",
      // Authentication (Phase 2) — pinned explicitly so tests never depend on
      // machine-local .env introspection.
      AUTH_SESSION_TTL_MS: `${24 * 60 * 60 * 1000}`,
      AUTH_SESSION_IDLE_MS: `${30 * 60 * 1000}`,
      AUTH_VERIFICATION_TOKEN_TTL_MS: `${24 * 60 * 60 * 1000}`,
      AUTH_PASSWORD_RESET_TOKEN_TTL_MS: `${60 * 60 * 1000}`,
      AUTH_LOGIN_MAX_ATTEMPTS: "5",
      AUTH_LOGIN_THROTTLE_MS: `${15 * 60 * 1000}`,
      PASSWORD_PEPPER: "test-pepper-not-secret",
      AUTH_PASSWORD_MIN_LENGTH: "6",
      AUTH_PASSWORD_MAX_LENGTH: "1024",
      AUTH_COOKIE_SECURE: "false",
      // Organizations (Phase 3) — pinned in the test env.
      ORG_INVITATION_TTL_MS: `${72 * 60 * 60 * 1000}`,
      // Deal Intelligence (Phase 9) — the ai client is stubbed in tests, but
      // parseEnv runs at app boot and requires these to be present.
      AI_SERVICE_URL: "http://127.0.0.1:8555",
      AI_SERVICE_TOKEN: "",
      AI_SERVICE_TIMEOUT_MS: "15000",
      // Quantum Optimization (Phase 10) — same contract: the quantum client
      // is stubbed in tests but parseEnv requires these at app boot.
      QUANTUM_SERVICE_URL: "http://127.0.0.1:8557",
      QUANTUM_SERVICE_TOKEN: "dev-token",
      QUANTUM_SERVICE_TIMEOUT_MS: "35000",
    },
  },
});