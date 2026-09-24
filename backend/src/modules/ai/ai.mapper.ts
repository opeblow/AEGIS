import type {
  ApprovalRequest,
  ApprovalWorkflow,
  Deal,
  DealDocument,
  DealParticipant,
  DealRequirement,
  Offer,
  OfferTransition,
  Prisma,
  Reconciliation,
  Settlement,
} from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import type { DealViewer } from "../negotiation/participant-policy.js";
import { canViewDocument } from "../documents/document-policy.js";
import { currencyInfo } from "../deals/deal.schemas.js";
import {
  dealIntelligenceContextSchema,
  type DealIntelligenceContext,
} from "./ai.schemas.js";

/**
 * Builds the AUTHORIZED deal-intelligence context for `viewer`.
 *
 * The AI/ML service never queries the database; everything it sees arrives in
 * this projection, and everything here has already been filtered by the
 * viewer's rights (see `projectIntelligenceContext`):
 *   - offers: only those where the viewer's organization is creator or
 *     recipient (point-to-point confidentiality);
 *   - documents: only those passing `canViewDocument` (uploader/owner/
 *     visibility window), excluding SUPERSEDED chain members;
 *   - approval requests: role/status/sequence only — never user identity;
 *   - negotiation events: only for offers visible to the viewer, and the
 *     acting organization is never attributed;
 *   - no tokens, no storageKeys, no passwords, no emails.
 *
 * The deal's full economics ARE included: ai-ml is a trusted internal
 * service and the viewer is an authenticated deal participant.
 */
export async function buildDealIntelligenceContext(
  viewer: DealViewer,
): Promise<DealIntelligenceContext> {
  const dealId = viewer.deal.id;
  const offers = await prisma.offer.findMany({ where: { dealId } });
  const [participants, documents, requirements, approvalWorkflow, settlement, offerTransitions] =
    await Promise.all([
      prisma.dealParticipant.findMany({ where: { dealId } }),
      prisma.dealDocument.findMany({
        where: { dealId },
        include: { visibilityParticipants: true },
      }),
      prisma.dealRequirement.findMany({ where: { dealId } }),
      prisma.approvalWorkflow.findFirst({
        where: { dealId },
        include: { requests: true },
      }),
      prisma.settlement.findUnique({
        where: { dealId },
        include: { reconciliation: true },
      }),
      prisma.offerTransition.findMany({
        where: { offerId: { in: offers.map((o) => o.id) } },
        orderBy: { createdAt: "asc" },
      }),
    ]);

  return projectIntelligenceContext(
    {
      deal: viewer.deal,
      participants,
      offers,
      documents: documents as Array<DealDocument & { visibilityParticipants: { organizationId: string }[] }>,
      requirements,
      approvalWorkflow,
      settlement,
      offerTransitions,
    },
    viewer,
  );
}

export interface DealIntelligenceSource {
  deal: Deal;
  participants: DealParticipant[];
  offers: Offer[];
  documents: Array<DealDocument & { visibilityParticipants: { organizationId: string }[] }>;
  requirements: DealRequirement[];
  approvalWorkflow: (ApprovalWorkflow & { requests: ApprovalRequest[] }) | null;
  settlement:
    | (Settlement & { reconciliation: Reconciliation | null })
    | null;
  offerTransitions: OfferTransition[];
}

/**
 * Pure projection of an authorized context. Every visibility rule lives here
 * so it can be unit-tested without a database; the async fetch layer only
 * gathers deal-scoped rows.
 */
export function projectIntelligenceContext(
  source: DealIntelligenceSource,
  viewer: DealViewer,
): DealIntelligenceContext {
  const participantOrg = new Map(
    source.participants.map((p) => [p.id, p.organizationId] as const),
  );

  // Point-to-point confidentiality: only offers the viewer's org created or
  // received.
  const visibleOfferIds = new Set(
    source.offers
      .filter(
        (offer) =>
          participantOrg.get(offer.createdByParticipantId) ===
            viewer.organizationId ||
          participantOrg.get(offer.recipientParticipantId) ===
            viewer.organizationId,
      )
      .map((offer) => offer.id),
  );
  const visibleOffers = source.offers.filter((offer) =>
    visibleOfferIds.has(offer.id),
  );

  // Only visibility-permitted, non-superseded documents.
  const visibleDocuments = source.documents.filter(
    (doc) =>
      doc.status !== "SUPERSEDED" &&
      canViewDocument(doc, viewer.organizationId, viewer.isOwner),
  );

  const deal = source.deal;
  const money = (
    amount: Prisma.Decimal | null | undefined,
    currency: string,
  ): string | null => (amount ? toMoneyString(amount, currency) : null);
  const iso = (d: Date | null | undefined): string | null =>
    d ? d.toISOString() : null;

  const assembled = {
    deal_id: deal.id,
    organization_id: deal.organizationId,
    viewer_organization_id: viewer.organizationId,
    deal: {
      id: deal.id,
      reference: deal.reference,
      type: deal.type,
      status: deal.status,
      name: deal.name,
      description: deal.description,
      currency: deal.currency,
      notional_amount: toMoneyString(deal.notionalAmount, deal.currency),
      settled_amount: money(deal.settledAmount, deal.currency),
      settlement_date: iso(deal.settlementDate),
      expires_at: iso(deal.expiresAt),
      version: deal.version,
      created_at: deal.createdAt.toISOString(),
      updated_at: deal.updatedAt.toISOString(),
    },
    offers: visibleOffers.map((offer) => ({
      id: offer.id,
      status: offer.status,
      version: offer.version,
      parent_offer_id: offer.parentOfferId,
      currency: offer.currency,
      amount: toMoneyString(offer.amount, offer.currency),
      price: money(offer.price, offer.currency),
      settlement_date: iso(offer.settlementDate),
      expires_at: iso(offer.expiresAt),
      submitted_at: iso(offer.submittedAt),
      created_at: offer.createdAt.toISOString(),
      created_by_organization_id:
        participantOrg.get(offer.createdByParticipantId) ?? null,
      recipient_organization_id:
        participantOrg.get(offer.recipientParticipantId) ?? null,
    })),
    documents: visibleDocuments.map((doc) => ({
      id: doc.id,
      document_type: doc.documentType,
      title: doc.title,
      status: doc.status,
      version: doc.version,
      chain_id: doc.chainId,
      supersedes_id: doc.supersedesId,
      original_filename: doc.originalFilename,
      size_bytes: doc.sizeBytes,
      sha256: doc.sha256,
      submitted_at: iso(doc.submittedAt),
      reviewed_at: iso(doc.reviewedAt),
      expires_at: iso(doc.expiresAt),
      created_at: doc.createdAt.toISOString(),
      // The backend does not extract text; documents arrive as binary/bytes.
      text: null,
    })),
    requirements: source.requirements.map((req) => ({
      id: req.id,
      requirement_type: req.requirementType,
      title: req.title,
      description: req.description,
      status: req.status,
      required: req.required,
      due_at: iso(req.dueAt),
      assigned_organization_id: req.assignedOrganizationId,
      satisfied_at: iso(req.satisfiedAt),
      created_at: req.createdAt.toISOString(),
    })),
    approval: source.approvalWorkflow
      ? {
          workflow_status: source.approvalWorkflow.status,
          started_at: iso(source.approvalWorkflow.startedAt),
          completed_at: iso(source.approvalWorkflow.completedAt),
          requests: source.approvalWorkflow.requests.map((req) => ({
            id: req.id,
            approver_role: req.approverRole,
            sequence: req.sequence,
            required: req.required,
            status: req.status,
            due_at: iso(req.dueAt),
            responded_at: iso(req.respondedAt),
          })),
        }
      : null,
    settlement: source.settlement
      ? {
          id: source.settlement.id,
          provider: source.settlement.provider,
          provider_reference: source.settlement.providerReference,
          status: source.settlement.status,
          amount: toMoneyString(source.settlement.amount, source.settlement.currency),
          currency: source.settlement.currency,
          asset_identifier: source.settlement.assetIdentifier,
          submitted_at: iso(source.settlement.submittedAt),
          completed_at: iso(source.settlement.completedAt),
          failed_at: iso(source.settlement.failedAt),
          failure_reason: source.settlement.failureReason,
          created_at: source.settlement.createdAt.toISOString(),
        }
      : null,
    reconciliation: source.settlement?.reconciliation
      ? {
          id: source.settlement.reconciliation.id,
          status: source.settlement.reconciliation.status,
          expected_amount: source.settlement.reconciliation.expectedAmount
            ? toMoneyString(
                source.settlement.reconciliation.expectedAmount,
                source.settlement.reconciliation.expectedCurrency,
              )
            : null,
          actual_amount: source.settlement.reconciliation.actualAmount
            ? toMoneyString(
                source.settlement.reconciliation.actualAmount,
                source.settlement.reconciliation.actualCurrency ?? "USD",
              )
            : null,
          expected_currency: source.settlement.reconciliation.expectedCurrency,
          actual_currency: source.settlement.reconciliation.actualCurrency,
          mismatch_reason: source.settlement.reconciliation.mismatchReason,
          checked_at: iso(source.settlement.reconciliation.checkedAt),
          resolved_at: iso(source.settlement.reconciliation.resolvedAt),
        }
      : null,
    negotiation_events: source.offerTransitions
      .filter((t) => visibleOfferIds.has(t.offerId))
      .map((t) => ({
        id: t.id,
        event_type: t.transitionType,
        offer_id: t.offerId,
        deal_id: deal.id,
        // Actor organization is intentionally not attributed (MVP).
        actor_organization_id: null,
        reason: t.reason,
        created_at: t.createdAt.toISOString(),
      })),
    client_version: "1.0" as const,
  };

  // Strict, mirror-of-ai-ml validation: a projection bug fails HERE, before
  // anything crosses the network.
  return dealIntelligenceContextSchema.parse(assembled);
}

/** Exact ISO 4217 minor-unit money string; never a float. */
export function toMoneyString(amount: Prisma.Decimal, currency: string): string {
  const { minor } = currencyInfo(currency);
  return amount.toFixed(minor);
}