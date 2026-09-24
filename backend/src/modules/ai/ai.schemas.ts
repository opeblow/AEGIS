import { z } from "zod";

/**
 * Deal Intelligence (Phase 9) schemas.
 *
 * The outgoing context schemas mirror `ai-ml/app/schemas/context.py` field
 * for field. The AI/ML service validates with `extra="forbid"`, so sending a
 * single unknown key is a 422; our own validation intentionally mirrors that
 * strictness so a mapper bug is caught BEFORE it reaches the wire. Money
 * values always travel as exact decimal strings (ISO 4217 minor-unit
 * precision) — never JS floats.
 *
 * The incoming response schemas mirror `ai-ml/app/schemas/output.py` (which
 * is `extra="allow"` for forward compatibility), so we pass through unknown
 * sub-fields while still validating every field the backend consumes.
 */

// ---------------------------------------------------------------------------
// Route validation
// ---------------------------------------------------------------------------

export const dealIdParamsSchema = z.object({
  dealId: z.string().uuid({ message: "dealId must be a valid UUID" }),
});

export const runIdParamsSchema = z.object({
  dealId: z.string().uuid({ message: "dealId must be a valid UUID" }),
  runId: z.string().uuid({ message: "runId must be a valid UUID" }),
});

export const DEAL_INTELLIGENCE_RUN_STATUSES = [
  "PENDING",
  "COMPLETED",
  "FAILED",
] as const;

export const listRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(DEAL_INTELLIGENCE_RUN_STATUSES).optional(),
});

export const intelligenceQueryBodySchema = z.object({
  question: z
    .string()
    .min(1, "question must not be empty")
    .max(512, "question must be at most 512 characters"),
});

// ---------------------------------------------------------------------------
// Shared field helpers
// ---------------------------------------------------------------------------

/** Non-empty exact-money string (never a float). */
const moneyStr = z
  .string()
  .min(1)
  .regex(/^\d+(\.\d+)?$/, "money must be a non-negative decimal string");

const dateStr = z.string().datetime({ offset: true });
const dateOpt = dateStr.nullable().optional();

// ---------------------------------------------------------------------------
// Outgoing DealIntelligenceContext / DealIntelligenceQuery
// ---------------------------------------------------------------------------

export const dealContextSchema = z.object({
  id: z.string(),
  reference: z.string(),
  type: z.string(),
  status: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  currency: z.string(),
  notional_amount: moneyStr,
  settled_amount: moneyStr.nullable().optional(),
  settlement_date: dateOpt,
  expires_at: dateOpt,
  version: z.number().int(),
  created_at: dateStr,
  updated_at: dateStr,
}).strict();

export const offerContextSchema = z.object({
  id: z.string(),
  status: z.string(),
  version: z.number().int(),
  parent_offer_id: z.string().nullable().optional(),
  currency: z.string(),
  amount: moneyStr,
  price: moneyStr.nullable().optional(),
  settlement_date: dateOpt,
  expires_at: dateOpt,
  submitted_at: dateOpt,
  created_at: dateStr,
  created_by_organization_id: z.string(),
  recipient_organization_id: z.string(),
}).strict();

export const documentContextSchema = z.object({
  id: z.string(),
  document_type: z.string(),
  title: z.string(),
  status: z.string(),
  version: z.number().int(),
  chain_id: z.string(),
  supersedes_id: z.string().nullable().optional(),
  original_filename: z.string().nullable().optional(),
  size_bytes: z.number().int().nullable().optional(),
  sha256: z.string().nullable().optional(),
  submitted_at: dateOpt,
  reviewed_at: dateOpt,
  expires_at: dateOpt,
  created_at: dateStr,
  // Extracted text is forwarded verbatim from the backend only when present.
  // The backend does not extract text, so this is always null today.
  text: z.string().nullable().optional(),
}).strict();

export const requirementContextSchema = z.object({
  id: z.string(),
  requirement_type: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  status: z.string(),
  required: z.boolean(),
  due_at: dateOpt,
  assigned_organization_id: z.string().nullable().optional(),
  satisfied_at: dateOpt,
  created_at: dateStr,
}).strict();

export const approvalRequestContextSchema = z.object({
  id: z.string(),
  approver_role: z.string().nullable().optional(),
  sequence: z.number().int(),
  required: z.boolean(),
  status: z.string(),
  due_at: dateOpt,
  responded_at: dateOpt,
}).strict();

export const approvalWorkflowContextSchema = z.object({
  workflow_status: z.string(),
  started_at: dateOpt,
  completed_at: dateOpt,
  requests: z.array(approvalRequestContextSchema).default([]),
}).strict();

export const settlementContextSchema = z.object({
  id: z.string(),
  provider: z.string(),
  provider_reference: z.string().nullable().optional(),
  status: z.string(),
  amount: moneyStr,
  currency: z.string(),
  asset_identifier: z.string().nullable().optional(),
  submitted_at: dateOpt,
  completed_at: dateOpt,
  failed_at: dateOpt,
  failure_reason: z.string().nullable().optional(),
  created_at: dateStr,
}).strict();

export const reconciliationContextSchema = z.object({
  id: z.string(),
  status: z.string(),
  expected_amount: moneyStr.nullable().optional(),
  actual_amount: moneyStr.nullable().optional(),
  expected_currency: z.string().nullable().optional(),
  actual_currency: z.string().nullable().optional(),
  mismatch_reason: z.string().nullable().optional(),
  checked_at: dateOpt,
  resolved_at: dateOpt,
}).strict();

export const negotiationEventContextSchema = z.object({
  id: z.string(),
  event_type: z.string(),
  offer_id: z.string().nullable().optional(),
  deal_id: z.string(),
  // Never attributed to a specific organization today (MVP confidentiality).
  actor_organization_id: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  created_at: dateStr,
}).strict();

export const dealIntelligenceContextSchema = z.object({
  deal_id: z.string(),
  organization_id: z.string(),
  viewer_organization_id: z.string(),
  deal: dealContextSchema,
  offers: z.array(offerContextSchema).default([]),
  documents: z.array(documentContextSchema).default([]),
  requirements: z.array(requirementContextSchema).default([]),
  approval: approvalWorkflowContextSchema.nullable().optional(),
  settlement: settlementContextSchema.nullable().optional(),
  reconciliation: reconciliationContextSchema.nullable().optional(),
  negotiation_events: z.array(negotiationEventContextSchema).default([]),
  client_version: z.literal("1.0").default("1.0"),
}).strict();

export const dealIntelligenceQuerySchema = dealIntelligenceContextSchema
  .extend({
    question: z.string().min(1).max(512),
  })
  .strict();

export type DealIntelligenceContext = z.infer<
  typeof dealIntelligenceContextSchema
>;
export type DealIntelligenceQuery = z.infer<
  typeof dealIntelligenceQuerySchema
>;

// ---------------------------------------------------------------------------
// Incoming response validation (mirrors output.py; extra fields pass through)
// ---------------------------------------------------------------------------

const providerMetaSchema = z
  .object({ provider: z.string(), version: z.string() })
  .passthrough();

const evidenceItemSchema = z
  .object({ label: z.string(), value: z.string() })
  .passthrough();

const offerComparisonSchema = z
  .object({
    currency: z.string(),
    compared_offers: z.array(z.string()).default([]),
    entries: z
      .array(
        z
          .object({
            field: z.string(),
            before: z.string(),
            after: z.string(),
            absolute_difference: z.string().nullable().optional(),
            relative_difference_percent: z.number().nullable().optional(),
            favorable_to: z.string().nullable().optional(),
            explanation: z.string(),
            confidence: z.number(),
            deterministic: z.boolean().default(true),
          })
          .passthrough(),
      )
      .default([]),
    summary: z.string(),
  })
  .passthrough();

const dealChangeSchema = z
  .object({
    field: z.string(),
    before: z.string(),
    after: z.string(),
    change_type: z.enum(["added", "removed", "modified", "status_modified"]),
    significance: z.enum(["none", "minor", "moderate", "material"]),
    source: z.string(),
    confidence: z.number(),
    deterministic: z.boolean().default(true),
    ai_interpretation: z.string().nullable().optional(),
  })
  .passthrough();

const riskFlagSchema = z
  .object({
    category: z.string(),
    severity: z.enum(["info", "low", "medium", "high"]),
    explanation: z.string(),
    evidence: z.array(z.string()).default([]),
    confidence: z.number(),
    deterministic_or_model: z
      .enum(["deterministic", "model"])
      .default("deterministic"),
    requires_review: z.boolean().default(true),
    finding: z.string().default("Potential issue detected"),
  })
  .passthrough();

const documentFindingSchema = z
  .object({
    document_id: z.string(),
    document_type: z.string(),
    title: z.string(),
    finding_type: z.string(),
    finding: z.string(),
    confidence: z.number(),
    requires_review: z.boolean().default(true),
    evidence: z.array(z.string()).default([]),
    label: z
      .enum(["AI finding", "Potential issue", "Requires review"])
      .default("AI finding"),
  })
  .passthrough();

const readinessExplanationSchema = z
  .object({
    required: z.number().int(),
    satisfied: z.number().int(),
    outstanding: z.number().int(),
    blocked: z.boolean(),
    explanation: z.string(),
    caveat: z.string().default(
      "Deterministic backend requirements remain authoritative; AI only " +
        "explains readiness, it never decides satisfaction.",
    ),
  })
  .passthrough();

const negotiationSummarySchema = z
  .object({
    summary: z.string(),
    major_concessions: z
      .array(
        z
          .object({
            field: z.string(),
            from_value: z.string(),
            to_value: z.string(),
            direction: z.string(),
          })
          .passthrough(),
      )
      .default([]),
    changed_terms: z.array(z.string()).default([]),
    unresolved_points: z.array(z.string()).default([]),
    latest_counterparty_position: z.string().default(""),
    timeline: z.array(z.string()).default([]),
    possible_blockers: z.array(z.string()).default([]),
  })
  .passthrough();

const dealSummarySchema = z
  .object({
    summary: z.string(),
    key_facts: z.array(evidenceItemSchema).default([]),
    model_summary: z.boolean().default(false),
  })
  .passthrough();

export const dealIntelligenceResultSchema = z
  .object({
    deal_id: z.string(),
    summary: dealSummarySchema,
    offer_comparison: offerComparisonSchema.nullable().optional(),
    changes: z.array(dealChangeSchema).default([]),
    risk_flags: z.array(riskFlagSchema).default([]),
    blockers: z.array(riskFlagSchema).default([]),
    document_findings: z.array(documentFindingSchema).default([]),
    readiness_explanation: readinessExplanationSchema.nullable().optional(),
    negotiation: negotiationSummarySchema.nullable().optional(),
    confidence: z.number().default(0.5),
    generated_at: dateStr,
    model: providerMetaSchema,
    version: z.string(),
    input_hash: z.string(),
    ai_warning: z.string(),
  })
  .passthrough();

export const queryAnswerSchema = z
  .object({
    deal_id: z.string(),
    question: z.string(),
    answer: z.string(),
    evidence: z.array(z.string()).default([]),
    within_scope: z.boolean(),
    confidence: z.number(),
    generated_at: dateStr,
    model: providerMetaSchema,
    version: z.string(),
    ai_warning: z.string(),
  })
  .passthrough();

// Wire envelope mirrors ai-ml/app/schemas/wire.py (`extra="forbid"`).
export const analyzeResponseSchema = z
  .object({
    result: dealIntelligenceResultSchema,
    input_hash: z.string().min(1),
  })
  .strict();

export const queryResponseSchema = z
  .object({
    answer: queryAnswerSchema,
    input_hash: z.string().min(1),
  })
  .strict();

export type DealIntelligenceResult = z.infer<
  typeof dealIntelligenceResultSchema
>;
export type QueryAnswer = z.infer<typeof queryAnswerSchema>;

export type IntelligenceRunStatus =
  (typeof DEAL_INTELLIGENCE_RUN_STATUSES)[number];