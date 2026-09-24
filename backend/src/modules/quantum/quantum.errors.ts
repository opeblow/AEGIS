import { AppError } from "../../lib/errors/index.js";

/**
 * Quantum Optimization (Phase 10) — client-safe error mapping.
 *
 * The client never leaks provider internals to the browser: upstream status
 * codes and error payloads are mapped onto stable backend `QUANTUM_*` codes,
 * the original details are attached as the AppError `cause` for server-side
 * logging, and only safe messages reach the client.
 */

export interface QuantumUpstreamErrorBody {
  code?: string;
  message?: string;
}

function parseUpstreamBody(raw: string | undefined): QuantumUpstreamErrorBody {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const error = (parsed as { error?: unknown }).error;
      if (error && typeof error === "object") {
        const errObj = error as Record<string, unknown>;
        return {
          code: typeof errObj.code === "string" ? errObj.code : undefined,
          message:
            typeof errObj.message === "string" ? errObj.message : undefined,
        };
      }
    }
  } catch {
    // non-JSON upstream error bodies are ignored
  }
  return {};
}

/**
 * Classifies a non-2xx upstream response into the backend's stable error
 * space. `upstreamRawBody` is the raw text body (used only for the upstream
 * `error.code`/`error.message`), never surfaced to clients.
 */
export function mapQuantumHttpError(
  status: number,
  upstreamRawBody?: string,
): AppError {
  const upstream = parseUpstreamBody(upstreamRawBody);
  const cause = new Error(
    `Quantum optimization service HTTP ${status}${upstream.code ? ` (${upstream.code})` : ""}${upstream.message ? `: ${upstream.message}` : ""}`,
  );

  switch (status) {
    case 401:
      return AppError.quantumServiceUnauthorized(undefined, cause);
    case 413:
      return AppError.quantumInputTooLarge();
    case 422:
      // The quantum service rejected the assembled problem (its own 422
      // validation / QUANTUM_PROBLEM_INVALID). This is a backend mapping or
      // constraint bug; stable code, safe message, cause for diagnostics.
      return AppError.quantumProblemRejected(undefined, cause);
    case 504:
      return AppError.quantumServiceTimeout(undefined, cause);
    case 503:
      return AppError.quantumServiceUnavailable(undefined, cause);
    case 502:
      return AppError.quantumServiceUnavailable(undefined, cause);
    case 500:
      return AppError.quantumOptimizationFailed(undefined, cause);
    default:
      return AppError.quantumServiceUnavailable(undefined, cause);
  }
}

/**
 * Classifies a transport-level failure. AbortController timeouts surface as
 * `AbortError` from fetch; everything else is a connectivity problem.
 */
export function mapQuantumNetworkError(cause: unknown): AppError {
  if (cause instanceof Error && cause.name === "AbortError") {
    return AppError.quantumServiceTimeout(undefined, cause);
  }
  return AppError.quantumServiceUnavailable(
    "The quantum optimization service could not be reached.",
    cause,
  );
}