import { describe, expect, it } from "vitest";
import {
  canonicalContextHash,
  stableStringify,
} from "../../../src/modules/ai/ai.service.js";
import type { DealIntelligenceContext } from "../../../src/modules/ai/ai.schemas.js";

const DEAL_ID = "11111111-1111-4111-8111-111111111111";

function baseContext(): DealIntelligenceContext {
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

describe("stableStringify", () => {
  it("serializes primitives and arrays deterministically", () => {
    expect(stableStringify([3, "z", true, null])).toBe(`[3,"z",true,null]`);
    expect(stableStringify("a")).toBe(`"a"`);
    expect(stableStringify(42)).toBe("42");
    expect(stableStringify(null)).toBe("null");
  });

  it("sorts object keys regardless of insertion order", () => {
    const first = { b: 1, a: { d: 4, c: 3 } };
    const second = { a: { c: 3, d: 4 }, b: 1 };
    expect(stableStringify(first)).toBe(stableStringify(second));
  });
});

describe("canonicalContextHash", () => {
  it("returns a 64-char hex digest", () => {
    expect(canonicalContextHash(baseContext())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is independent of object key insertion order", () => {
    const original = baseContext() as Record<string, unknown>;
    const reshuffled: Record<string, unknown> = {};
    for (const key of Object.keys(original).reverse()) {
      reshuffled[key] = original[key];
    }
    expect(canonicalContextHash(original as unknown as DealIntelligenceContext)).toBe(
      canonicalContextHash(reshuffled as unknown as DealIntelligenceContext),
    );
  });

  it("changes when the context changes", () => {
    const changed = baseContext();
    changed.deal.notional_amount = "2000000.00";
    expect(canonicalContextHash(changed)).not.toBe(canonicalContextHash(baseContext()));
  });

  it("ignores array element ordering differences only as they appear", () => {
    // Arrays keep order (a reordered array is a different context); objects
    // inside them still hash by sorted keys.
    const a = baseContext();
    const b = baseContext();
    a.negotiation_events = [
      { id: "e1", event_type: "x", deal_id: DEAL_ID, created_at: "2026-01-01T00:00:00.000Z" },
      { id: "e2", event_type: "y", deal_id: DEAL_ID, created_at: "2026-01-02T00:00:00.000Z" },
    ];
    b.negotiation_events = [
      { id: "e2", event_type: "y", deal_id: DEAL_ID, created_at: "2026-01-02T00:00:00.000Z" },
      { id: "e1", event_type: "x", deal_id: DEAL_ID, created_at: "2026-01-01T00:00:00.000Z" },
    ];
    expect(canonicalContextHash(a)).not.toBe(canonicalContextHash(b));
  });
});