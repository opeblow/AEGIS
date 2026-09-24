import { getEnv } from "../../config/env.js";
import { AppError } from "../../lib/errors/index.js";
import { mapAiHttpError, mapAiNetworkError } from "./ai.errors.js";
import {
  analyzeResponseSchema,
  queryResponseSchema,
  type DealIntelligenceContext,
  type DealIntelligenceQuery,
  type DealIntelligenceResult,
  type QueryAnswer,
} from "./ai.schemas.js";

/**
 * Deal Intelligence (Phase 9) — HTTP client for the internal ai-ml service.
 *
 * Transport discipline:
 *  - Node's global `fetch` (Node >= 20). No perf/security exposure on the
 *    browser here — the backend is the ONLY client of ai-ml.
 *  - `AbortController` enforces `AI_SERVICE_TIMEOUT_MS` per call.
 *  - Bearer token attached ONLY when configured (ai-ml is unauthenticated in
 *    dev with no token).
 *  - Every non-2xx and every malformed body is mapped to a stable `AI_*`
 *    AppError; upstream internals never reach the client.
 *
 * Dependency injection mirrors `setSettlementProviderForTesting` so
 * integration tests can stub the transport without a running ai-ml.
 */
export interface AiClient {
  readonly name: string;
  analyze(
    context: DealIntelligenceContext,
  ): Promise<{ result: DealIntelligenceResult; inputHash: string }>;
  query(input: DealIntelligenceQuery): Promise<{ answer: QueryAnswer; inputHash: string }>;
}

export interface AiClientDeps {
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
          ...(deps.token ? { authorization: `Bearer ${deps.token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (cause) {
      throw mapAiNetworkError(cause);
    }

    if (!raw.ok) {
      const rawBody = await raw.text().catch(() => undefined);
      throw mapAiHttpError(raw.status, rawBody);
    }

    let parsed: unknown;
    try {
      const text = await raw.text();
      parsed = text.length === 0 ? {} : JSON.parse(text);
    } catch (cause) {
      throw AppError.aiInvalidResponse(undefined, cause);
    }

    const validated = responseSchema.safeParse(parsed);
    if (!validated.success) {
      throw AppError.aiInvalidResponse(undefined, validated.error);
    }
    return validated.data as T;
  } finally {
    clearTimeout(timer);
  }
}

interface ZodSchemaLike<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown };
}

export function createAiClient(deps: AiClientDeps = {}): AiClient {
  const baseUrl = deps.baseUrl ?? getEnv().AI_SERVICE_URL;
  const timeoutMs = deps.timeoutMs ?? getEnv().AI_SERVICE_TIMEOUT_MS;
  const token = deps.token;
  const fetchFn = deps.fetchFn ?? globalThis.fetch;

  const postDeps: PostDeps = {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    token,
    timeoutMs,
    fetchFn,
  };

  return {
    name: "ai-ml",
    analyze(context) {
      return post(
        "/analyze",
        context,
        postDeps,
        analyzeResponseSchema,
      ).then((envelope) => ({ result: envelope.result, inputHash: envelope.input_hash }));
    },
    query(input) {
      return post(
        "/query",
        input,
        postDeps,
        queryResponseSchema,
      ).then((envelope) => ({ answer: envelope.answer, inputHash: envelope.input_hash }));
    },
  };
}

let aiClientInstance: AiClient | null = null;

/** Lazy singleton wired from the validated environment. */
export function getAiClient(): AiClient {
  if (!aiClientInstance) {
    const env = getEnv();
    aiClientInstance = createAiClient({
      baseUrl: env.AI_SERVICE_URL,
      token: env.AI_SERVICE_TOKEN || undefined,
      timeoutMs: env.AI_SERVICE_TIMEOUT_MS,
    });
  }
  return aiClientInstance;
}

/** Test seam: swap the transport without touching `getEnv()`. */
export function setAiClientForTesting(client: AiClient | null): void {
  aiClientInstance = client;
}