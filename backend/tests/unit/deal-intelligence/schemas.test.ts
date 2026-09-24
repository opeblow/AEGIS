import { describe, expect, it } from "vitest";
import {
  dealIntelligenceContextSchema,
  dealIntelligenceQuerySchema,
  dealIntelligenceResultSchema,
  queryAnswerSchema,
} from "../../../src/modules/ai/ai.schemas.js";

const DEAL_ID = "11111111-1111-4111-8111-111111111111";

function validContext() {
  return {
    deal_id: DEAL_ID,
    organization_id: "b".repeat(36),
    viewer_organization_id: "c".repeat(36),
    deal: {
      id: DEAL_ID,
      reference: "AEG-2026-000001",
      type: "RWA_PURCHASE",
      status: "NEGOTIATION",
      name: "Test deal",
      description: null,
      currency: "USD",
      notional_amount: "1250000.50",
      settled_amount: null,
      settlement_date: null,
      expires_at: "2026-12-01T00:00:00.000Z",
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

function validResult() {
  return {
    deal_id: DEAL_ID,
    summary: {
      summary: "Deterministic checks pass.",
      key_facts: [{ label: "ready", value: "true" }],
      model_summary: false,
    },
    offer_comparison: null,
    changes: [],
    risk_flags: [],
    blockers: [],
    document_findings: [],
    readiness_explanation: null,
    negotiation: null,
    confidence: 0.5,
    generated_at: "2026-09-20T10:00:00.000Z",
    model: { provider: "deterministic", version: "1.0" },
    version: "1.0",
    input_hash: "a".repeat(48),
    ai_warning: "Advisory only.",
  };
}

describe("deal intelligence context schema", () => {
  it("parses a complete context and defaults missing arrays/version", () => {
    const input = { ...validContext() } as Record<string, unknown>;
    delete input.offers;
    delete input.documents;
    delete input.requirements;
    delete input.negotiation_events;
    delete input.client_version;
    const parsed = dealIntelligenceContextSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.offers).toEqual([]);
      expect(parsed.data.documents).toEqual([]);
      expect(parsed.data.client_version).toBe("1.0");
      expect(parsed.data.deal.notional_amount).toBe("1250000.50");
    }
  });

  it("accepts JPY zero-minor money strings", () => {
    const input = validContext();
    (input.deal as Record<string, unknown>).currency = "JPY";
    (input.deal as Record<string, unknown>).notional_amount = "90000000";
    expect(dealIntelligenceContextSchema.safeParse(input).success).toBe(true);
  });

  it("rejects non-decimal money strings", () => {
    for (const bad of ["-50", "1e6", "abc", "1,000.50", ""]) {
      const input = validContext();
      (input.deal as Record<string, unknown>).notional_amount = bad;
      const parsed = dealIntelligenceContextSchema.safeParse(input);
      expect(parsed.success).toBe(false);
    }
  });

  it("rejects unknown top-level keys (mirrors ai-ml extra=forbid)", () => {
    const input = validContext() as Record<string, unknown>;
    input.leaked_field = "nope";
    expect(dealIntelligenceContextSchema.safeParse(input).success).toBe(false);
  });

  it("rejects unknown keys inside nested objects", () => {
    const input = validContext();
    (input.deal as Record<string, unknown>).leaked_field = "nope";
    expect(dealIntelligenceContextSchema.safeParse(input).success).toBe(false);
  });

  it("rejects missing required fields", () => {
    const input = validContext();
    delete (input.deal as Record<string, unknown>).notional_amount;
    expect(dealIntelligenceContextSchema.safeParse(input).success).toBe(false);
  });

  it("rejects a non-datetime timestamp", () => {
    const input = validContext();
    (input.deal as Record<string, unknown>).created_at = "yesterday";
    expect(dealIntelligenceContextSchema.safeParse(input).success).toBe(false);
  });
});

describe("deal intelligence query schema", () => {
  it("requires a non-empty question and stays strict", () => {
    const empty = dealIntelligenceQuerySchema.safeParse({ ...validContext(), question: "" });
    expect(empty.success).toBe(false);

    const good = dealIntelligenceQuerySchema.safeParse({ ...validContext(), question: "Is ready?" });
    expect(good.success).toBe(true);

    const extra = { ...validContext(), question: "Is ready?", extra: 1 };
    expect(dealIntelligenceQuerySchema.safeParse(extra).success).toBe(false);
  });
});

describe("deal intelligence result schema", () => {
  it("passes through unknown fields for forward compatibility (extra=allow)", () => {
    const input = validResult() as Record<string, unknown>;
    input.forward_key = { nested: [1, 2, 3] };
    (input.summary as Record<string, unknown>).blurb = "new field";
    const parsed = dealIntelligenceResultSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.forward_key).toEqual({ nested: [1, 2, 3] });
      expect((parsed.data.summary as Record<string, unknown>).blurb).toBe("new field");
    }
  });

  it("requires deal_id, model, and generated_at", () => {
    for (const key of ["deal_id", "model", "generated_at", "version", "input_hash", "ai_warning", "summary"]) {
      const input = validResult() as Record<string, unknown>;
      delete input[key];
      const parsed = dealIntelligenceResultSchema.safeParse(input);
      expect(parsed.success).toBe(false);
    }
  });

  it("applies defaults for optional result sections", () => {
    const base = { ...validResult() } as Record<string, unknown>;
    delete base.changes;
    delete base.risk_flags;
    delete base.blockers;
    delete base.document_findings;
    const parsed = dealIntelligenceResultSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.changes).toEqual([]);
      expect(parsed.data.risk_flags).toEqual([]);
      expect(parsed.data.blockers).toEqual([]);
      expect(parsed.data.document_findings).toEqual([]);
    }
  });

  it("rejects a malformed model block", () => {
    const input = validResult() as Record<string, unknown>;
    input.model = { provider: 42 };
    expect(dealIntelligenceResultSchema.safeParse(input).success).toBe(false);
  });
});

describe("query answer schema", () => {
  it("accepts a complete answer and rejects empty / missing within_scope", () => {
    const answer = {
      deal_id: DEAL_ID,
      question: "Is ready?",
      answer: "Yes.",
      evidence: [],
      within_scope: true,
      confidence: 0.9,
      generated_at: "2026-09-20T10:00:00.000Z",
      model: { provider: "deterministic", version: "1.0" },
      version: "1.0",
      ai_warning: "Advisory.",
    };
    expect(queryAnswerSchema.safeParse(answer).success).toBe(true);

    const missing = { ...answer };
    delete (missing as Record<string, unknown>).within_scope;
    expect(queryAnswerSchema.safeParse(missing).success).toBe(false);

    const extra = { ...answer, forward_key: "kept" };
    const parsed = queryAnswerSchema.safeParse(extra);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.forward_key).toBe("kept");
    }
  });
});