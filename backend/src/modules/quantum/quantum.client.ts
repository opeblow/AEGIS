import { getEnv } from "../../config/env.js";
import { AppError } from "../../lib/errors/index.js";
import { mapQuantumHttpError, mapQuantumNetworkError } from "./quantum.errors.js";
import {
  comparisonResponseSchema,
  solverResultSchema,
  type QuantumComparison,
  type QuantumProblem,
  type QuantumSolverResult,
  type SolverName,
} from "./quantum.schemas.js";

/**
 * Quantum Optimization (Phase 10) — HTTP client for the internal quantum
 * optimization service.
 *
 * Transport discipline:
 *  - Node's global `fetch` (Node >= 20). The backend is the ONLY client.
 *  - `AbortController` enforces `QUANTUM_SERVICE_TIMEOUT_MS` per call.
 *  - Bearer token attached ONLY when configured (quantum is unauthenticated
 *    in dev with no token).
 *  - Every non-2xx and every malformed body is mapped to a stable `QUANTUM_*`
 *    AppError; upstream internals never reach the client.
 *
 * Dependency injection mirrors `setAiClientForTesting` so integration tests
 * can stub the transport without a running quantum service.
 */

export interface OptimizePayload {
  problem: QuantumProblem;
  solver?: SolverName;
}

export interface ComparePayload {
  problem: QuantumProblem;
  quantumSolver?: SolverName;
}

export interface QuantumClient {
  readonly name: string;
  optimize(
    payload: OptimizePayload,
  ): Promise<{ result: QuantumSolverResult; problemId: string }>;
  compare(
    payload: ComparePayload,
  ): Promise<{ result: QuantumComparison; problemId: string }>;
}

export interface QuantumClientDeps {
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

interface PostDeps {
  baseUrl: string;
  token?: string;
  timeoutMs: number;
  fetchFn: typeof fetch;
}

async function post<T>(
  path: string,
  body: unknown,
  deps: PostDeps,
  responseSchema: ZodSchemaLike<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  let raw: Response;
  try {
    try {
      raw = await deps.fetchFn(`${deps.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-request-id": requestIdHeader(),
          ...(deps.token ? { authorization: `Bearer ${deps.token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (cause) {
      throw mapQuantumNetworkError(cause);
    }

    if (!raw.ok) {
      const rawBody = await raw.text().catch(() => undefined);
      throw mapQuantumHttpError(raw.status, rawBody);
    }

    let parsed: unknown;
    try {
      const text = await raw.text();
      parsed = text.length === 0 ? {} : JSON.parse(text);
    } catch (cause) {
      throw AppError.quantumInvalidResponse(undefined, cause);
    }

    const validated = responseSchema.safeParse(parsed);
    if (!validated.success) {
      throw AppError.quantumInvalidResponse(undefined, validated.error);
    }
    return validated.data as T;
  } finally {
    clearTimeout(timer);
  }
}

function requestIdHeader(): string {
  // Mirrors the backend's request-id header so an error can be correlated
  // with upstream logs. A short random suffix keeps it unique across the
  // backend process without a dependency on a request context.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

interface ZodSchemaLike<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown };
}

export function createQuantumClient(deps: QuantumClientDeps = {}): QuantumClient {
  const baseUrl = deps.baseUrl ?? getEnv().QUANTUM_SERVICE_URL;
  const timeoutMs = deps.timeoutMs ?? getEnv().QUANTUM_SERVICE_TIMEOUT_MS;
  const token = deps.token;
  const fetchFn = deps.fetchFn ?? globalThis.fetch;

  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");

  return {
    name: "quantum-optimization",
    optimize(payload) {
      return post(
        "/optimize",
        { problem: payload.problem, ...(payload.solver ? { solver: payload.solver } : {}) },
        { baseUrl: normalizedBaseUrl, token, timeoutMs, fetchFn },
        solverResultSchema,
      ).then((result) => ({ result, problemId: result.problem_id }));
    },
    compare(payload) {
      return post(
        "/compare",
        {
          problem: payload.problem,
          ...(payload.quantumSolver ? { quantum_solver: payload.quantumSolver } : {}),
        },
        { baseUrl: normalizedBaseUrl, token, timeoutMs, fetchFn },
        comparisonResponseSchema,
      ).then((result) => ({ result, problemId: result.problem_id }));
    },
  };
}

let quantumClientInstance: QuantumClient | null = null;

/** Lazy singleton wired from the validated environment. */
export function getQuantumClient(): QuantumClient {
  if (!quantumClientInstance) {
    const env = getEnv();
    quantumClientInstance = createQuantumClient({
      baseUrl: env.QUANTUM_SERVICE_URL,
      token: env.QUANTUM_SERVICE_TOKEN || undefined,
      timeoutMs: env.QUANTUM_SERVICE_TIMEOUT_MS,
    });
  }
  return quantumClientInstance;
}

/** Test seam: swap the transport without touching `getEnv()`. */
export function setQuantumClientForTesting(client: QuantumClient | null): void {
  quantumClientInstance = client;
}