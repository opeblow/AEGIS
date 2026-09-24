import { describe, expect, it, vi } from "vitest";
import { createAiClient } from "../../../src/modules/ai/ai.client.js";
import type { DealIntelligenceContext } from "../../../src/modules/ai/ai.schemas.js";
import { AppError } from "../../../src/lib/errors/index.js";

const DEAL_ID = "11111111-1111-4111-8111-111111111111";

function validResult(dealId: string) {
  return {
    deal_id: dealId,
    summary: { summary: "No material changes.", key_facts: [], model_summary: false },
    offer_comparison: null,
    changes: [],
    risk_flags: [],
    blockers: [],
    document_findings: [],
    readiness_explanation: null,
    negotiation: null,
    confidence: 0.71,
    generated_at: "2026-09-20T10:00:00.000Z",
    model: { provider: "deterministic", version: "1.0" },
    version: "1.0",
    input_hash: "a".repeat(48),
    ai_warning: "Advisory only.",
  };
}

function validContext(): DealIntelligenceContext {
  return {
    deal_id: DEAL_ID,
    organization_id: "b".repeat(36),
    viewer_organization_id: "b".repeat(36),
    deal: {
      id: DEAL_ID,
      reference: "AEG-2026-000001",
      type: "RWA_PURCHASE",
      status: "NEGOTIATION",
      name: "Test deal",
      currency: "USD",
      notional_amount: "1250000.50",
      version: 1,
      created_at: "2026-09-01T10:00:00.000Z",
      updated_at: "2026-09-02T10:00:00.000Z",
    },
    offers: [],
    documents: [],
    requirements: [],
    approval: null,
    settlement: null,
    reconciliation: null,
    negotiation_events: [],
    client_version: "1.0",
  };
}

function mockFetchOnce(respond: () => Response) {
  return vi.fn(async () => respond());
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createAiClient", () => {
  it("parses a successful analyze envelope", async () => {
    const fetchFn = mockFetchOnce(() =>
      jsonResponse(200, {
        result: validResult(DEAL_ID),
        input_hash: "a".repeat(48),
      }),
    );
    const client = createAiClient({ baseUrl: "http://ai:8555", fetchFn });
    const { result, inputHash } = await client.analyze(validContext());
    expect(result.deal_id).toBe(DEAL_ID);
    expect(result.summary.summary).toBe("No material changes.");
    expect(inputHash).toBe("a".repeat(48));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(fetchFn.mock.calls[0][0])).toBe("http://ai:8555/analyze");
  });

  it("parses a successful query envelope", async () => {
    const fetchFn = mockFetchOnce(() =>
      jsonResponse(200, {
        answer: {
          deal_id: DEAL_ID,
          question: "Is ready?",
          answer: "Yes.",
          evidence: ["already submitted"],
          within_scope: true,
          confidence: 0.9,
          generated_at: "2026-09-20T10:00:00.000Z",
          model: { provider: "deterministic", version: "1.0" },
          version: "1.0",
          ai_warning: "Advisory only.",
        },
        input_hash: "a".repeat(48),
      }),
    );
    const client = createAiClient({ baseUrl: "http://ai:8555/", fetchFn });
    const { answer } = await client.query({ ...validContext(), question: "Is ready?" });
    expect(answer.within_scope).toBe(true);
    expect(String(fetchFn.mock.calls[0][0])).toBe("http://ai:8555/query");
  });

  it("rejects an envelope with unknown keys (mirrors ai-ml extra=forbid)", async () => {
    const fetchFn = mockFetchOnce(() =>
      jsonResponse(200, {
        result: validResult(DEAL_ID),
        input_hash: "a".repeat(48),
        extra_field: "not allowed",
      }),
    );
    const client = createAiClient({ baseUrl: "http://ai:8555", fetchFn });
    await expect(client.analyze(validContext())).rejects.toMatchObject({
      code: "AI_INVALID_RESPONSE",
    });
  });

  it("rejects a result missing required fields", async () => {
    const { generated_at: _drop, ...missing } = validResult(DEAL_ID);
    void _drop;
    const fetchFn = mockFetchOnce(() =>
      jsonResponse(200, { result: missing, input_hash: "a".repeat(48) }),
    );
    const client = createAiClient({ baseUrl: "http://ai:8555", fetchFn });
    await expect(client.analyze(validContext())).rejects.toMatchObject({
      code: "AI_INVALID_RESPONSE",
    });
  });

  it("maps each upstream HTTP status to its stable code", async () => {
    const cases: Array<[number, string]> = [
      [401, "AI_SERVICE_UNAUTHORIZED"],
      [413, "AI_INPUT_TOO_LARGE"],
      [429, "AI_RATE_LIMITED"],
      [500, "AI_ANALYSIS_FAILED"],
      [502, "AI_SERVICE_UNAVAILABLE"],
      [503, "AI_SERVICE_UNAVAILABLE"],
      [504, "AI_SERVICE_TIMEOUT"],
      [501, "AI_SERVICE_UNAVAILABLE"],
    ];
    for (const [status, code] of cases) {
      const fetchFn = mockFetchOnce(() =>
        jsonResponse(status, { error: { code: "UPSTREAM", message: "boom" } }),
      );
      const client = createAiClient({ baseUrl: "http://ai:8555", fetchFn });
      await expect(client.analyze(validContext())).rejects.toMatchObject({ code });
    }
  });

  it("maps a 422 AI_QUERY_OUT_OF_SCOPE without leaking details", async () => {
    const fetchFn = mockFetchOnce(() =>
      jsonResponse(422, {
        error: {
          code: "AI_QUERY_OUT_OF_SCOPE",
          message: "internal scope hint nobody should see",
        },
      }),
    );
    const client = createAiClient({ baseUrl: "http://ai:8555", fetchFn });
    const error = (await client
      .analyze(validContext())
      .catch((e: unknown) => e)) as AppError;
    expect(error.code).toBe("AI_QUERY_OUT_OF_SCOPE");
    expect(error.message).not.toContain("internal scope hint");
  });

  it("turns other 422 codes into AI_INVALID_RESPONSE with a log hint", async () => {
    const fetchFn = mockFetchOnce(() =>
      jsonResponse(422, { error: { code: "AI_PROVIDER_ERROR", message: "provider down" } }),
    );
    const client = createAiClient({ baseUrl: "http://ai:8555", fetchFn });
    const error = (await client
      .analyze(validContext())
      .catch((e: unknown) => e)) as AppError;
    expect(error.code).toBe("AI_INVALID_RESPONSE");
    expect(error.message).toMatch(/upstream model provider failed/i);
  });

  it("maps a non-JSON body to AI_INVALID_RESPONSE", async () => {
    const fetchFn = mockFetchOnce(() =>
      new Response("not json", { status: 200, headers: { "content-type": "text/plain" } }),
    );
    const client = createAiClient({ baseUrl: "http://ai:8555", fetchFn });
    await expect(client.analyze(validContext())).rejects.toMatchObject({
      code: "AI_INVALID_RESPONSE",
    });
  });

  it("maps an empty success body to AI_INVALID_RESPONSE", async () => {
    const fetchFn = mockFetchOnce(() => new Response("", { status: 200 }));
    const client = createAiClient({ baseUrl: "http://ai:8555", fetchFn });
    await expect(client.analyze(validContext())).rejects.toMatchObject({
      code: "AI_INVALID_RESPONSE",
    });
  });

  it("maps generic transport errors to AI_SERVICE_UNAVAILABLE", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const client = createAiClient({ baseUrl: "http://ai:8555", fetchFn });
    await expect(client.analyze(validContext())).rejects.toMatchObject({
      code: "AI_SERVICE_UNAVAILABLE",
    });
  });

  it("maps AbortError timeouts to AI_SERVICE_TIMEOUT", async () => {
    const fetchFn = vi.fn(async () => {
      throw new DOMException("timed out", "AbortError");
    });
    const client = createAiClient({ baseUrl: "http://ai:8555", fetchFn });
    await expect(client.analyze(validContext())).rejects.toMatchObject({
      code: "AI_SERVICE_TIMEOUT",
    });
  });

  it("sends a Bearer token only when configured", async () => {
    const withToken = vi.fn(async () =>
      jsonResponse(200, { result: validResult(DEAL_ID), input_hash: "a".repeat(48) }),
    );
    const authed = createAiClient({ baseUrl: "http://ai:8555", token: "tok-123", fetchFn: withToken });
    await authed.analyze(validContext());
    const authedInit = withToken.mock.calls[0][1] as RequestInit;
    expect(authedInit.headers).toMatchObject({ authorization: "Bearer tok-123" });

    const withoutToken = vi.fn(async () =>
      jsonResponse(200, { result: validResult(DEAL_ID), input_hash: "a".repeat(48) }),
    );
    const anon = createAiClient({ baseUrl: "http://ai:8555", fetchFn: withoutToken });
    await anon.analyze(validContext());
    const anonInit = withoutToken.mock.calls[0][1] as RequestInit;
    expect((anonInit.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("strips a trailing slash from the base URL", async () => {
    const fetchFn = mockFetchOnce(() =>
      jsonResponse(200, { result: validResult(DEAL_ID), input_hash: "a".repeat(48) }),
    );
    const client = createAiClient({ baseUrl: "http://ai:8555///", fetchFn });
    await client.analyze(validContext());
    expect(String(fetchFn.mock.calls[0][0])).toBe("http://ai:8555/analyze");
  });

  it("keeps client-safe messages for upstream errors", async () => {
    const fetchFn = mockFetchOnce(() =>
      jsonResponse(500, { error: { code: "AI_ANALYSIS_FAILED", message: "model crashed" } }),
    );
    const client = createAiClient({ baseUrl: "http://ai:8555", fetchFn });
    const error = (await client
      .analyze(validContext())
      .catch((e: unknown) => e)) as AppError;
    expect(error.message).not.toMatch(/model crashed/);
  });
});
