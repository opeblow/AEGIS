import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

const importMetaUrl = import.meta.url;
const __dirname = path.dirname(fileURLToPath(importMetaUrl));

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"], {
      errorMap: () => ({
        message: 'NODE_ENV must be one of: "development", "test", "production"',
      }),
    })
    .default("development"),

  PORT: z.coerce
    .number({
      errorMap: () => ({ message: "PORT must be a valid port number" }),
    })
    .int()
    .min(1, "PORT must be between 1 and 65535")
    .max(65535, "PORT must be between 1 and 65535")
    .default(4000),

  HOST: z.string().min(1, "HOST must not be empty").default("0.0.0.0"),

  DATABASE_URL: z
    .string({
      errorMap: () => ({ message: "DATABASE_URL is required" }),
    })
    .min(1, "DATABASE_URL is required")
    .regex(
      /^postgres(ql)?:\/\//i,
      "DATABASE_URL must be a postgresql:// connection string",
    ),

  // The public origin(s) of the client application, used both for CORS and
  // the CSRF Origin check. Comma-separated list. `*` is dev/test only.
  CORS_ORIGIN: z
    .string()
    .default("*")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"], {
      errorMap: () => ({
        message:
          "LOG_LEVEL must be one of: fatal, error, warn, info, debug, trace, silent",
      }),
    })
    .default("info"),

  // ------------------------------------------------------------
  // Authentication (Phase 2)
  // ------------------------------------------------------------

  // Absolute session lifetime before forced re-authentication.
  AUTH_SESSION_TTL_MS: z.coerce
    .number({
      errorMap: () => ({ message: "AUTH_SESSION_TTL_MS must be a number" }),
    })
    .int()
    .positive()
    .default(7 * 24 * 60 * 60 * 1000), // 7 days

  // Idle timeout — a session unused for this long is rejected.
  AUTH_SESSION_IDLE_MS: z.coerce
    .number({
      errorMap: () => ({ message: "AUTH_SESSION_IDLE_MS must be a number" }),
    })
    .int()
    .positive()
    .default(30 * 60 * 1000), // 30 minutes

  // Email verification token validity.
  AUTH_VERIFICATION_TOKEN_TTL_MS: z.coerce
    .number({
      errorMap: () => ({
        message: "AUTH_VERIFICATION_TOKEN_TTL_MS must be a number",
      }),
    })
    .int()
    .positive()
    .default(24 * 60 * 60 * 1000), // 24 hours

  // Password reset token validity.
  AUTH_PASSWORD_RESET_TOKEN_TTL_MS: z.coerce
    .number({
      errorMap: () => ({
        message: "AUTH_PASSWORD_RESET_TOKEN_TTL_MS must be a number",
      }),
    })
    .int()
    .positive()
    .default(60 * 60 * 1000), // 60 minutes

  // Per-account failed-login threshold before temporary throttling.
  AUTH_LOGIN_MAX_ATTEMPTS: z.coerce
    .number({
      errorMap: () => ({ message: "AUTH_LOGIN_MAX_ATTEMPTS must be a number" }),
    })
    .int()
    .min(1)
    .default(5),

  // Temporary throttle window after failed attempts.
  AUTH_LOGIN_THROTTLE_MS: z.coerce
    .number({
      errorMap: () => ({ message: "AUTH_LOGIN_THROTTLE_MS must be a number" }),
    })
    .int()
    .positive()
    .default(15 * 60 * 1000), // 15 minutes

  // Optional server-side Argon2id password pepper (max 32 bytes, per the
  // Argon2 spec limit). Store outside PostgreSQL in secret management.
  PASSWORD_PEPPER: z
    .string()
    .max(32, "PASSWORD_PEPPER must be at most 32 characters")
    .optional()
    .or(z.literal("")),

  // Minimum accepted password length (OWASP-style length-first policy).
  AUTH_PASSWORD_MIN_LENGTH: z.coerce
    .number({
      errorMap: () => ({
        message: "AUTH_PASSWORD_MIN_LENGTH must be a number",
      }),
    })
    .int()
    .min(6, "Minimum password length must be at least 6")
    .default(12),

  // Maximum accepted password length (abuse prevention, not a truncation limit).
  AUTH_PASSWORD_MAX_LENGTH: z.coerce
    .number({
      errorMap: () => ({
        message: "AUTH_PASSWORD_MAX_LENGTH must be a number",
      }),
    })
    .int()
    .positive()
    .default(1024),

  // Force Secure cookies even outside production (e.g. dev behind HTTPS).
  AUTH_COOKIE_SECURE: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),

  // ------------------------------------------------------------
  // Organizations (Phase 3)
  // ------------------------------------------------------------

  // Organization invitation token validity.
  ORG_INVITATION_TTL_MS: z.coerce
    .number({
      errorMap: () => ({
        message: "ORG_INVITATION_TTL_MS must be a number",
      }),
    })
    .int()
    .positive()
    .default(72 * 60 * 60 * 1000), // 72 hours

  // ------------------------------------------------------------
  // Documents & requirements (Phase 6)
  // ------------------------------------------------------------

  // Storage backend for uploaded document bytes. Only the dev-friendly
  // local-disk adapter ships in Phase 6; production adapters (S3 etc.) arrive
  // with the same DocumentStorage interface.
  DOCUMENT_STORAGE_PROVIDER: z
    .enum(["local-disk"], {
      errorMap: () => ({
        message: "DOCUMENT_STORAGE_PROVIDER must be one of: local-disk",
      }),
    })
    .default("local-disk"),

  // Filesystem root for the local-disk adapter. Defaults to `<cwd>/.document-storage`.
  DOCUMENT_STORAGE_ROOT: z
    .string()
    .min(1, "DOCUMENT_STORAGE_ROOT must not be empty")
    .default(path.resolve(process.cwd(), ".document-storage")),

  // Hard cap on a single uploaded document (bytes). The route-level bodyLimit
  // mirrors this so the whole request is rejected before the parser runs.
  DOCUMENT_MAX_SIZE_BYTES: z.coerce
    .number({
      errorMap: () => ({ message: "DOCUMENT_MAX_SIZE_BYTES must be a number" }),
    })
    .int()
    .positive()
    .default(25 * 1024 * 1024), // 25 MB

  // Window in which an UPLOADING/UPLOADED document must be completed+submitted
  // before the worker expires it.
  DOCUMENT_UPLOAD_WINDOW_MS: z.coerce
    .number({
      errorMap: () => ({
        message: "DOCUMENT_UPLOAD_WINDOW_MS must be a number",
      }),
    })
    .int()
    .positive()
    .default(2 * 60 * 60 * 1000), // 2 hours

  // Review window for SUBMITTED -> (ACCEPTED|REJECTED), and the retention
  // window of an ACCEPTED document before worker expiry (`expiresAt` is
  // re-armed on each review transition).
  DOCUMENT_REVIEW_WINDOW_MS: z.coerce
    .number({
      errorMap: () => ({
        message: "DOCUMENT_REVIEW_WINDOW_MS must be a number",
      }),
    })
    .int()
    .positive()
    .default(72 * 60 * 60 * 1000), // 72 hours

  // ------------------------------------------------------------
  // Settlement & Reconciliation (Phase 8)
  // ------------------------------------------------------------

  // Settlement provider to use. "mock" for local development/testing,
  // "mock" is test/development only. "canton" uses the Metatarz
  // non-custodial wallet flow (users sign Canton CC/CIP-56 transfers in their
  // browser; the backend verifies the resulting update via the Metatarz RPC).
  SETTLEMENT_PROVIDER: z
    .enum(["mock", "canton"], {
      errorMap: () => ({
        message: "SETTLEMENT_PROVIDER must be one of: mock, canton",
      }),
    })
    .default("mock"),

  // ------------------------------------------------------------
  // Metatarz Canton wallet (non-custodial EVM shim for Canton)
  // ------------------------------------------------------------

  // EVM-compatible JSON-RPC endpoint exposed by the Metatarz wallet service.
  // Mainnet: https://canton.rpc.wallet.metatarz.xyz  (chain 31337)
  // Testnet: https://canton-testnet.rpc.wallet.metatarz.xyz (chain 30337)
  METATARZ_RPC_URL: z
    .string()
    .url("METATARZ_RPC_URL must be a valid URL")
    .default("https://canton-testnet.rpc.wallet.metatarz.xyz"),

  // Canton chain id served by the Metatarz shim (used for balance/state reads
  // and receipt verification; Canton itself is not an EVM chain).
  METATARZ_CHAIN_ID: z.coerce
    .number({
      errorMap: () => ({ message: "METATARZ_CHAIN_ID must be a number" }),
    })
    .int()
    .positive()
    .default(30337),

  // Per-call timeout for Metatarz RPC reads (fetch abort).
  METATARZ_TIMEOUT_MS: z.coerce
    .number({
      errorMap: () => ({ message: "METATARZ_TIMEOUT_MS must be a number" }),
    })
    .int()
    .positive()
    .default(15000),

  // ------------------------------------------------------------
  // Deal Intelligence (Phase 9)
  // ------------------------------------------------------------

  // Internal AI/ML service base URL (the separate ai-ml service). Required at
  // boot — the backend cannot offer deal intelligence without a configured
  // endpoint, and fail-fast beats a silently non-functional feature.
  AI_SERVICE_URL: z
    .string({
      errorMap: () => ({ message: "AI_SERVICE_URL is required" }),
    })
    .min(1, "AI_SERVICE_URL is required")
    .url("AI_SERVICE_URL must be a valid http(s) URL"),

  // Shared service-to-service bearer token. Optional in development (ai-ml
  // serves unauthenticated when it has no token configured), REQUIRED in
  // production (enforced in getEnv).
  AI_SERVICE_TOKEN: z.string().optional().or(z.literal("")),

  // Per-call timeout for the AI/ML service (fetch abort). Bounds the analyze
  // request so a hung provider never pins an HTTP request.
  AI_SERVICE_TIMEOUT_MS: z.coerce
    .number({
      errorMap: () => ({ message: "AI_SERVICE_TIMEOUT_MS must be a number" }),
    })
    .int()
    .positive()
    .default(15000),

  // Official OneSwap on Canton. The API key is server-only and comes from
  // the deployment secret manager. There is no implicit mock fallback.
  ONESWAP_API_KEY: z.string().optional().or(z.literal("")),
  ONESWAP_ENVIRONMENT: z.enum(["mainnet", "devnet"]).default("devnet"),
  ONESWAP_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

  // ------------------------------------------------------------
  // Quantum Optimization (Phase 10)
  // ------------------------------------------------------------

  // Internal quantum optimization service base URL (the separate
  // "quantum computing" FastAPI service). Required at boot — the backend
  // cannot offer deal route optimization without a configured endpoint,
  // and fail-fast beats a silently non-functional feature.
  QUANTUM_SERVICE_URL: z
    .string({
      errorMap: () => ({ message: "QUANTUM_SERVICE_URL is required" }),
    })
    .min(1, "QUANTUM_SERVICE_URL is required")
    .url("QUANTUM_SERVICE_URL must be a valid http(s) URL"),

  // Shared service-to-service bearer token. Optional in development (the
  // quantum service serves unauthenticated only when it has no token
  // configured), REQUIRED in production (enforced in getEnv).
  QUANTUM_SERVICE_TOKEN: z.string().optional().or(z.literal("")),

  // Per-call timeout for the quantum service (fetch abort). Defaults above
  // the service's own `timeout_seconds` (default 30s) so the backend outlasts
  // a long-running solver instead of aborting an in-flight solve.
  QUANTUM_SERVICE_TIMEOUT_MS: z.coerce
    .number({
      errorMap: () => ({
        message: "QUANTUM_SERVICE_TIMEOUT_MS must be a number",
      }),
    })
    .int()
    .positive()
    .default(35000),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Loads environment variables from project-root `.env` (if present) and
 * validates them against the schema. Throws a descriptive error listing every
 * invalid/missing variable so the process fails fast with a clear message.
 */
export function parseEnv(dotenvPath?: string): Env {
  loadDotenv({
    path: dotenvPath ?? path.resolve(__dirname, "../../.env"),
    quiet: true,
  });

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => {
        const key = issue.path.join(".");
        return `  - ${key}: ${issue.message}`;
      })
      .join("\n");

    throw new Error(
      `Invalid environment configuration. Fix the following issues:\n${issues}`,
    );
  }

  return result.data;
}

/**
 * Lazily-resolved singleton so the env is parsed exactly once per process.
 */
let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (cachedEnv === null) {
    cachedEnv = parseEnv();
    if (
      cachedEnv.NODE_ENV === "production" &&
      cachedEnv.CORS_ORIGIN.includes("*")
    ) {
      throw new Error(
        "Refusing to start in production with CORS_ORIGIN set to '*'. " +
          "Configure explicit origins for production.",
      );
    }
    if (cachedEnv.NODE_ENV === "production" && !cachedEnv.AI_SERVICE_TOKEN) {
      throw new Error(
        "Refusing to start in production without AI_SERVICE_TOKEN. " +
          "The AI/ML service must authenticate the backend.",
      );
    }
    if (cachedEnv.NODE_ENV === "production" && !cachedEnv.QUANTUM_SERVICE_TOKEN) {
      throw new Error(
        "Refusing to start in production without QUANTUM_SERVICE_TOKEN. " +
          "The quantum optimization service must authenticate the backend.",
      );
    }
    if (cachedEnv.NODE_ENV === "production" && cachedEnv.SETTLEMENT_PROVIDER !== "canton") {
      throw new Error(
        "Refusing to start in production with SETTLEMENT_PROVIDER=mock. " +
          "Configure a real Canton settlement adapter before production use.",
      );
    }
    if (cachedEnv.NODE_ENV === "production" && cachedEnv.ONESWAP_ENVIRONMENT !== "mainnet") {
      throw new Error(
        "Refusing to start production with OneSwap devnet selected. Configure ONESWAP_ENVIRONMENT=mainnet.",
      );
    }
  }
  return cachedEnv;
}

export function getCorsOrigins(): string[] {
  const env = getEnv();
  return env.CORS_ORIGIN;
}

export function envDescription(): string {
  const env = getEnv();
  return [
    `environment=${env.NODE_ENV}`,
    `host=${env.HOST}`,
    `port=${env.PORT}`,
    "database=configured",
    `settlementProvider=${env.SETTLEMENT_PROVIDER}`,
    `aiService=${env.AI_SERVICE_URL}`,
    `quantumService=${env.QUANTUM_SERVICE_URL}`,
  ].join(" ");
}
