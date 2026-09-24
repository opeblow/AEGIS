import { AppError } from "../../lib/errors/index.js";

/**
 * Deal Intelligence (Phase 9) — client-safe error mapping.
 *
 * The client never leaks provider internals to the browser: upstream status
 * codes and error payloads are mapped onto stable backend `AI_*` codes, the
 * original details are attached as the AppError `cause` for server-side
 * logging, and only safe messages reach the client.
 */

export interface AiUpstreamErrorBody {
  code?: string;
  message?: string;
}

function parseUpstreamBody(raw: string | undefined): AiUpstreamErrorBody {
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

const LOG_HINT: Record<string, string> = {
  AI_PROVIDER_ERROR: "upstream model provider failed",
  AI_UNSUPPORTED_DOCUMENT: "upstream cannot process a submitted document",
};

/**
 * Classifies a non-2xx upstream response into the backend's stable error
 * space. `upstreamRawBody` is the raw text body (used only for the upstream
 * `error.code`/`error.message`), never surfaced to clients.
 */
export function mapAiHttpError(
  status: number,
  upstreamRawBody?: string,
): AppError {
  const upstream = parseUpstreamBody(upstreamRawBody);
  const cause = new Error(
    `AI/ML service HTTP ${status}${upstream.code ? ` (${upstream.code})` : ""}${upstream.message ? `: ${upstream.message}` : ""}`,
  );

  switch (status) {
    case 401:
      return AppError.aiServiceUnauthorized(undefined, cause);
    case 413:
      return AppError.aiInputTooLarge();
    case 422:
      return upstream.code === "AI_QUERY_OUT_OF_SCOPE"
        ? AppError.aiQueryOutOfScope()
        : AppError.aiInvalidResponse(
            LOG_HINT[upstream.code ?? ""]
              ? `The intelligence service rejected the request (${LOG_HINT[upstream.code ?? ""]}).`
              : undefined,
            cause,
          );
    case 429:
      return AppError.aiRateLimited(undefined);
    case 504:
      return AppError.aiServiceTimeout(undefined, cause);
    case 503:
      return AppError.aiServiceUnavailable(undefined, cause);
    case 502:
      return AppError.aiServiceUnavailable(undefined, cause);
    case 500:
      return AppError.aiAnalysisFailed(undefined, cause);
    default:
      return AppError.aiServiceUnavailable(undefined, cause);
  }
}

/**
 * Classifies a transport-level failure. AbortController timeouts surface as
 * `AbortError` from fetch; everything else is a connectivity problem.
 */
export function mapAiNetworkError(cause: unknown): AppError {
  if (cause instanceof Error && cause.name === "AbortError") {
    return AppError.aiServiceTimeout(undefined, cause);
  }
  return AppError.aiServiceUnavailable(
    "The intelligence service could not be reached.",
    cause,
  );
}