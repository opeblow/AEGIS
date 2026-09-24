import { createHash } from "node:crypto";
import type {
  DealParticipant,
  Offer,
  OfferTransition,
  Organization,
  Prisma,
} from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors/index.js";
import {
  SecurityEventType,
  writeSecurityEvent,
} from "../auth/security-events.js";
import {
  requireOfferLegalTransition,
  offerReasonOf,
  offerTransitionTypeFor,
  type OfferStatus,
} from "./offer-state.js";
import {
  toPublicNegotiationEvent,
  toPublicOffer,
  toPublicOfferTransition,
  type PublicNegotiationEvent,
  type PublicOffer,
  type PublicOfferTransition,
} from "./negotiation.types.js";
import type {
  AcceptOfferBody,
  CounterOfferBody,
  CreateOfferBody,
  NegotiationQuery,
  OfferQuery,
  RejectOfferBody,
  SubmitOfferBody,
  WithdrawOfferBody,
} from "./negotiation.schemas.js";
import type { DealViewer } from "./participant-policy.js";
import type { RequestMeta } from "../organizations/organization.service.js";

type OfferWithOrg = Offer & {
  createdBy: DealParticipant & { organization: Organization };
  recipient: DealParticipant & { organization: Organization };
};

const OFFER_PARTY_INCLUDE = {
  createdBy: { include: { organization: true } },
  recipient: { include: { organization: true } },
} satisfies Prisma.OfferInclude;

/** Offers may only be created/advanced while the deal is negotiating. */
const NEGOTIABLE_DEAL_STATUSES: ReadonlySet<string> = new Set([
  "OPEN",
  "NEGOTIATING",
]);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalPayload(body: {
  amount: string;
  price?: string | null;
  currency: string;
  settlementDate?: Date | null;
  expiresAt?: Date | null;
}): string {
  return JSON.stringify({
    amount: body.amount,
    price: body.price ?? null,
    currency: body.currency,
    settlementDate: body.settlementDate?.toISOString() ?? null,
    expiresAt: body.expiresAt?.toISOString() ?? null,
  });
}

export function assertDealNegotiable(deal: { status: string }): void {
  if (!NEGOTIABLE_DEAL_STATUSES.has(deal.status)) {
    throw AppError.offerInvalidState(
      `Offers can only be created or advanced while the deal is OPEN or NEGOTIATING (current status: ${deal.status}).`,
    );
  }
}

function assertViewerCanSend(viewer: DealViewer): void {
  if (viewer.participant.participantType === "OBSERVER") {
    throw AppError.offerRecipientInvalid(
      "OBSERVER participants cannot send offers.",
    );
  }
}

function assertRecipientEligible(
  recipient: DealParticipant,
  senderParticipantId: string,
): void {
  if (recipient.id === senderParticipantId) {
    throw AppError.offerRecipientInvalid(
      "You cannot send an offer to yourself.",
    );
  }
  if (recipient.status !== "ACTIVE") {
    throw AppError.offerRecipientInvalid(
      "The recipient is not an ACTIVE participant of this deal.",
    );
  }
  if (recipient.participantType === "OBSERVER") {
    throw AppError.offerRecipientInvalid(
      "OBSERVER participants cannot receive offers.",
    );
  }
}

function assertCurrencyMatches(
  deal: DealViewer["deal"],
  currency: string,
): void {
  if (currency !== deal.currency) {
    throw AppError.invalidCurrency(
      `Offer currency must match the deal currency (${deal.currency}).`,
    );
  }
}

/** Fetches an offer if (and only if) the viewer's org is one of its parties. */
async function fetchOfferForViewer(
  dealId: string,
  offerId: string,
  viewerOrganizationId: string,
): Promise<OfferWithOrg> {
  const offer = await prisma.offer.findFirst({
    where: {
      id: offerId,
      dealId,
      OR: [
        { createdBy: { organizationId: viewerOrganizationId } },
        { recipient: { organizationId: viewerOrganizationId } },
      ],
    },
    include: OFFER_PARTY_INCLUDE,
  });
  if (!offer) throw AppError.offerNotFound();
  return offer;
}

/**
 * Applies one offer state-machine transition atomically: conditional
 * status+version update, then the append-only transition row. Returns null
 * when the conditional update lost a race (status/version already moved).
 */
async function applyOfferTransition(
  tx: Prisma.TransactionClient,
  offer: { id: string; dealId: string; status: OfferStatus; version: number },
  toStatus: OfferStatus,
  requestId: string | null,
  reason: string,
  actorUserId: string | null,
  extra?: { submittedAt?: Date },
): Promise<{ offer: OfferWithOrg | null; transition: OfferTransition }> {
  const applied = await tx.offer.updateMany({
    where: { id: offer.id, status: offer.status, version: offer.version },
    data: { status: toStatus, version: { increment: 1 }, ...(extra ?? {}) },
  });
  if (applied.count === 0) {
    return {
      offer: null,
      transition: {
        id: "",
        offerId: offer.id,
        dealId: offer.dealId,
        requestId,
        transitionType: offerTransitionTypeFor(toStatus),
        fromStatus: offer.status,
        toStatus,
        reason,
        actorUserId,
        createdAt: new Date(0),
      } as OfferTransition,
    };
  }
  const transition = await tx.offerTransition.create({
    data: {
      offerId: offer.id,
      dealId: offer.dealId,
      requestId,
      transitionType: offerTransitionTypeFor(toStatus),
      fromStatus: offer.status,
      toStatus,
      reason,
      actorUserId,
    },
  });
  const updated = await tx.offer.findFirst({
    where: { id: offer.id },
    include: OFFER_PARTY_INCLUDE,
  });
  return { offer: updated, transition };
}

/** Marks an expired offer EXPIRED (lazy expiry on the action path). */
async function markExpiredBestEffort(
  tx: Prisma.TransactionClient,
  offer: { id: string; dealId: string; status: OfferStatus; version: number },
  actorUserId: string | null,
): Promise<void> {
  const applied = await tx.offer.updateMany({
    where: { id: offer.id, status: offer.status, version: offer.version },
    data: { status: "EXPIRED", version: { increment: 1 } },
  });
  if (applied.count === 0) return;
  await tx.offerTransition.create({
    data: {
      offerId: offer.id,
      dealId: offer.dealId,
      requestId: null,
      transitionType: "OFFER_EXPIRED",
      fromStatus: offer.status,
      toStatus: "EXPIRED",
      reason: offerReasonOf("OFFER_EXPIRED"),
      actorUserId,
    },
  });
}

/** Walks the ancestor chain marking accepted-away COUNTERED offers SUPERSEDED. */
async function supersedeAncestors(
  tx: Prisma.TransactionClient,
  child: Offer,
  actorUserId: string,
  requestId: string,
  organizationId: string,
): Promise<void> {
  let parentId = child.parentOfferId;
  while (parentId) {
    const parent = await tx.offer.findFirst({ where: { id: parentId } });
    if (!parent) break;
    if (parent.status !== "COUNTERED") break;

    const applied = await tx.offer.updateMany({
      where: { id: parent.id, status: "COUNTERED", version: parent.version },
      data: { status: "SUPERSEDED", version: { increment: 1 } },
    });
    if (applied.count === 0) break;

    await tx.offerTransition.create({
      data: {
        offerId: parent.id,
        dealId: parent.dealId,
        requestId,
        transitionType: "OFFER_SUPERSEDED",
        fromStatus: "COUNTERED",
        toStatus: "SUPERSEDED",
        reason: "Superseded because a descendant counteroffer was accepted.",
        actorUserId,
      },
    });
    await writeSecurityEvent(tx, {
      type: SecurityEventType.OFFER_SUPERSEDED,
      userId: actorUserId,
      organizationId,
      metadata: { offerId: parent.id, dealId: parent.dealId, requestId },
      ipAddress: null,
      userAgent: null,
    });
    parentId = parent.parentOfferId;
  }
}

/** Reactivates the parent of a rejected counteroffer (or expires it). */
async function reactivateParentOnReject(
  tx: Prisma.TransactionClient,
  parent: Offer,
  actorUserId: string,
  requestId: string,
): Promise<void> {
  const to: OfferStatus =
    parent.expiresAt && parent.expiresAt.getTime() <= Date.now()
      ? "EXPIRED"
      : "SUBMITTED";
  const applied = await tx.offer.updateMany({
    where: { id: parent.id, status: "COUNTERED", version: parent.version },
    data: { status: to, version: { increment: 1 } },
  });
  if (applied.count === 0) return;
  await tx.offerTransition.create({
    data: {
      offerId: parent.id,
      dealId: parent.dealId,
      requestId,
      transitionType: offerTransitionTypeFor(to),
      fromStatus: "COUNTERED",
      toStatus: to,
      reason:
        to === "SUBMITTED"
          ? "Counteroffer rejected; the earlier offer is live again."
          : "Counteroffer rejected; the earlier offer's deadline has passed.",
      actorUserId,
    },
  });
}

export interface OfferActionResult {
  offer: PublicOffer;
  transition: PublicOfferTransition;
  replay: boolean;
}

async function renderReplay(
  viewer: DealViewer,
  snapshot: OfferWithOrg,
  transition: OfferTransition,
): Promise<OfferActionResult> {
  const latest = await prisma.offer.findFirst({
    where: { id: snapshot.id },
    include: OFFER_PARTY_INCLUDE,
  });
  return {
    offer: toPublicOffer(latest ?? snapshot, viewer.organizationId),
    transition: toPublicOfferTransition(transition),
    replay: true,
  };
}

// ---------------------------------------------------------------------------
// Create & submit
// ---------------------------------------------------------------------------

/** Creates a DRAFT offer. Direct offers target a recipient participant. */
export async function createOffer(
  viewer: DealViewer,
  dealId: string,
  body: CreateOfferBody,
  actorUserId: string,
  meta: RequestMeta,
): Promise<PublicOffer> {
  assertDealNegotiable(viewer.deal);
  assertViewerCanSend(viewer);
  assertCurrencyMatches(viewer.deal, body.currency);

  const recipient = await prisma.dealParticipant.findFirst({
    where: { id: body.recipientParticipantId, dealId },
  });
  if (!recipient) {
    throw AppError.offerRecipientInvalid(
      "The recipient is not a participant of this deal.",
    );
  }
  assertRecipientEligible(recipient, viewer.participant.id);

  const payloadHash = sha256(
    canonicalPayload({
      amount: body.amount,
      price: body.price,
      currency: body.currency,
      settlementDate: body.settlementDate,
      expiresAt: body.expiresAt,
    }),
  );

  return prisma.$transaction(async (tx) => {
    if (body.idempotencyKey) {
      const keyHash = sha256(body.idempotencyKey);
      const existing = await tx.offer.findFirst({
        where: {
          dealId,
          createdByParticipantId: viewer.participant.id,
          idempotencyKeyHash: keyHash,
        },
        include: OFFER_PARTY_INCLUDE,
      });
      if (existing) {
        return toPublicOffer(existing, viewer.organizationId);
      }
    }

    const offer = await tx.offer.create({
      data: {
        dealId,
        createdByParticipantId: viewer.participant.id,
        recipientParticipantId: recipient.id,
        status: "DRAFT",
        version: 1,
        currency: body.currency,
        amount: body.amount,
        price: body.price ?? null,
        settlementDate: body.settlementDate ?? null,
        expiresAt: body.expiresAt ?? null,
        idempotencyKeyHash: body.idempotencyKey
          ? sha256(body.idempotencyKey)
          : null,
        idempotencyPayloadHash: payloadHash,
      },
      include: OFFER_PARTY_INCLUDE,
    });

    await tx.offerTransition.create({
      data: {
        offerId: offer.id,
        dealId,
        requestId: null,
        transitionType: "OFFER_CREATED",
        fromStatus: "DRAFT",
        toStatus: "DRAFT",
        reason: offerReasonOf("OFFER_CREATED"),
        actorUserId,
      },
    });

    await writeSecurityEvent(tx, {
      type: SecurityEventType.OFFER_CREATED,
      userId: actorUserId,
      organizationId: viewer.organizationId,
      metadata: { offerId: offer.id, dealId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return toPublicOffer(offer, viewer.organizationId);
  });
}

/** Sender moves a DRAFT offer to SUBMITTED (it becomes actionable). */
export async function submitOffer(
  viewer: DealViewer,
  dealId: string,
  offerId: string,
  body: SubmitOfferBody,
  actorUserId: string,
  meta: RequestMeta,
): Promise<OfferActionResult> {
  const offer = await fetchOfferForViewer(
    dealId,
    offerId,
    viewer.organizationId,
  );
  if (offer.createdBy.organizationId !== viewer.organizationId) {
    throw AppError.forbidden(
      "Only the sending organization can submit this offer.",
    );
  }
  assertDealNegotiable(viewer.deal);

  const replay = await prisma.offerTransition.findFirst({
    where: { offerId: offer.id, requestId: body.requestId },
    orderBy: { createdAt: "asc" },
  });
  if (replay) return renderReplay(viewer, offer, replay);

  const outcome = await prisma.$transaction(async (tx) => {
    const txReplay = await tx.offerTransition.findFirst({
      where: { offerId: offer.id, requestId: body.requestId },
      orderBy: { createdAt: "asc" },
    });
    if (txReplay) return { kind: "replay" as const, transition: txReplay };

    requireOfferLegalTransition(offer.status, "SUBMITTED");
    if (offer.expiresAt && offer.expiresAt.getTime() <= Date.now()) {
      throw AppError.offerExpired();
    }

    const applied = await applyOfferTransition(
      tx,
      offer,
      "SUBMITTED",
      body.requestId,
      offerReasonOf("OFFER_SUBMITTED"),
      actorUserId,
      { submittedAt: new Date() },
    );
    if (!applied.offer) return { kind: "race" as const };
    if (applied.offer.status !== "SUBMITTED") {
      throw AppError.offerConcurrencyConflict("Offer was already submitted.");
    }

    await writeSecurityEvent(tx, {
      type: SecurityEventType.OFFER_SUBMITTED,
      userId: actorUserId,
      organizationId: viewer.organizationId,
      metadata: { offerId: offer.id, dealId, requestId: body.requestId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      kind: "changed" as const,
      offer: applied.offer,
      transition: applied.transition,
    };
  });

  if (outcome.kind === "replay")
    return renderReplay(viewer, offer, outcome.transition);
  if (outcome.kind === "race") throw AppError.offerConcurrencyConflict();
  return {
    offer: toPublicOffer(outcome.offer, viewer.organizationId),
    transition: toPublicOfferTransition(outcome.transition),
    replay: false,
  };
}

// ---------------------------------------------------------------------------
// Counteroffer
// ---------------------------------------------------------------------------

/**
 * Receiver answers a live SUBMITTED offer with a counteroffer. The child is
 * born SUBMITTED and the parent is conditionally advanced SUBMITTED→COUNTERED
 * in the same transaction — a lost race rolls back the child, so two
 * concurrent counters can never fork the chain.
 */
export async function counterOffer(
  viewer: DealViewer,
  dealId: string,
  offerId: string,
  body: CounterOfferBody,
  actorUserId: string,
  meta: RequestMeta,
): Promise<{
  offer: PublicOffer;
  parent: PublicOffer;
  transition: PublicOfferTransition;
  replay: boolean;
}> {
  const parent = await fetchOfferForViewer(
    dealId,
    offerId,
    viewer.organizationId,
  );
  if (parent.recipient.organizationId !== viewer.organizationId) {
    throw AppError.forbidden(
      "Only the receiving organization can counter an offer.",
    );
  }
  assertDealNegotiable(viewer.deal);
  assertViewerCanSend(viewer);
  assertCurrencyMatches(viewer.deal, body.currency);

  const ineligibleSender =
    parent.createdBy.status !== "ACTIVE" ||
    parent.createdBy.participantType === "OBSERVER";

  const childPayloadHash = sha256(
    canonicalPayload({
      amount: body.amount,
      price: body.price,
      currency: body.currency,
      settlementDate: body.settlementDate,
      expiresAt: body.expiresAt,
    }),
  );

  const replay = await prisma.offerTransition.findFirst({
    where: { offerId: parent.id, requestId: body.requestId },
    orderBy: { createdAt: "asc" },
  });
  if (replay) {
    const child = await prisma.offer.findFirst({
      where: { parentOfferId: parent.id },
      orderBy: { createdAt: "asc" },
      include: OFFER_PARTY_INCLUDE,
    });
    if (!child) throw AppError.offerInvalidState("Counteroffer not found.");
    const latest = await prisma.offer.findFirst({
      where: { id: parent.id },
      include: OFFER_PARTY_INCLUDE,
    });
    return {
      offer: toPublicOffer(child, viewer.organizationId),
      parent: toPublicOffer(latest ?? parent, viewer.organizationId),
      transition: toPublicOfferTransition(replay),
      replay: true,
    };
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const txReplay = await tx.offerTransition.findFirst({
      where: { offerId: parent.id, requestId: body.requestId },
      orderBy: { createdAt: "asc" },
    });
    if (txReplay) return { kind: "replay" as const, transition: txReplay };

    requireOfferLegalTransition(parent.status, "COUNTERED");
    if (
      ineligibleSender ||
      (parent.expiresAt && parent.expiresAt.getTime() <= Date.now())
    ) {
      await markExpiredBestEffort(tx, parent, actorUserId);
      throw AppError.offerInvalidState(
        "The receiving participant can no longer counter this offer.",
      );
    }

    const child = await tx.offer.create({
      data: {
        dealId,
        createdByParticipantId: viewer.participant.id,
        recipientParticipantId: parent.createdByParticipantId,
        parentOfferId: parent.id,
        status: "SUBMITTED",
        version: 1,
        currency: body.currency,
        amount: body.amount,
        price: body.price ?? null,
        settlementDate: body.settlementDate ?? null,
        expiresAt: body.expiresAt ?? null,
        submittedAt: new Date(),
        idempotencyKeyHash: body.idempotencyKey
          ? sha256(body.idempotencyKey)
          : null,
        idempotencyPayloadHash: childPayloadHash,
      },
      include: OFFER_PARTY_INCLUDE,
    });

    await tx.offerTransition.create({
      data: {
        offerId: child.id,
        dealId,
        requestId: null,
        transitionType: "OFFER_CREATED",
        fromStatus: "DRAFT",
        toStatus: "SUBMITTED",
        reason: "Counteroffer created. born submitted.",
        actorUserId,
      },
    });

    const parentResult = await applyOfferTransition(
      tx,
      parent,
      "COUNTERED",
      body.requestId,
      "Counteroffer submitted.",
      actorUserId,
    );
    if (!parentResult.offer) {
      // Lose the race or an invalid parent state: roll everything back by
      // throwing — transaction rollback removes the orphan child.
      throw AppError.offerConcurrencyConflict(
        "This offer was modified. Reload and retry.",
      );
    }

    await writeSecurityEvent(tx, {
      type: SecurityEventType.OFFER_COUNTERED,
      userId: actorUserId,
      organizationId: viewer.organizationId,
      metadata: {
        offerId: parent.id,
        dealId,
        childOfferId: child.id,
        requestId: body.requestId,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      kind: "changed" as const,
      child,
      parent: parentResult.offer,
      transition: parentResult.transition,
    };
  });

  if (outcome.kind === "replay") {
    const child = await prisma.offer.findFirst({
      where: { parentOfferId: parent.id },
      orderBy: { createdAt: "asc" },
      include: OFFER_PARTY_INCLUDE,
    });
    if (!child) throw AppError.offerInvalidState("Counteroffer not found.");
    const latest = await prisma.offer.findFirst({
      where: { id: parent.id },
      include: OFFER_PARTY_INCLUDE,
    });
    return {
      offer: toPublicOffer(child, viewer.organizationId),
      parent: toPublicOffer(latest ?? parent, viewer.organizationId),
      transition: toPublicOfferTransition(outcome.transition),
      replay: true,
    };
  }

  return {
    offer: toPublicOffer(outcome.child, viewer.organizationId),
    parent: toPublicOffer(outcome.parent, viewer.organizationId),
    transition: toPublicOfferTransition(outcome.transition),
    replay: false,
  };
}

// ---------------------------------------------------------------------------
// Accept / reject / withdraw
// ---------------------------------------------------------------------------

/** Receiver accepts a live offer; all superseded ancestors are expired. */
export async function acceptOffer(
  viewer: DealViewer,
  dealId: string,
  offerId: string,
  body: AcceptOfferBody,
  actorUserId: string,
  meta: RequestMeta,
): Promise<OfferActionResult> {
  const offer = await fetchOfferForViewer(
    dealId,
    offerId,
    viewer.organizationId,
  );
  if (offer.recipient.organizationId !== viewer.organizationId) {
    throw AppError.forbidden(
      "Only the receiving organization can accept this offer.",
    );
  }
  assertDealNegotiable(viewer.deal);

  const replay = await prisma.offerTransition.findFirst({
    where: { offerId: offer.id, requestId: body.requestId },
    orderBy: { createdAt: "asc" },
  });
  if (replay) return renderReplay(viewer, offer, replay);

  const outcome = await prisma.$transaction(async (tx) => {
    const txReplay = await tx.offerTransition.findFirst({
      where: { offerId: offer.id, requestId: body.requestId },
      orderBy: { createdAt: "asc" },
    });
    if (txReplay) return { kind: "replay" as const, transition: txReplay };

    requireOfferLegalTransition(offer.status, "ACCEPTED");
    if (offer.expiresAt && offer.expiresAt.getTime() <= Date.now()) {
      await markExpiredBestEffort(tx, offer, actorUserId);
      throw AppError.offerExpired();
    }

    const applied = await applyOfferTransition(
      tx,
      offer,
      "ACCEPTED",
      body.requestId,
      body.reason
        ? `Accepted: ${body.reason}`
        : offerReasonOf("OFFER_ACCEPTED"),
      actorUserId,
    );
    if (!applied.offer) return { kind: "race" as const };

    await supersedeAncestors(
      tx,
      offer,
      actorUserId,
      body.requestId,
      viewer.organizationId,
    );

    await writeSecurityEvent(tx, {
      type: SecurityEventType.OFFER_ACCEPTED,
      userId: actorUserId,
      organizationId: viewer.organizationId,
      metadata: { offerId: offer.id, dealId, requestId: body.requestId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      kind: "changed" as const,
      offer: applied.offer,
      transition: applied.transition,
    };
  });

  if (outcome.kind === "replay")
    return renderReplay(viewer, offer, outcome.transition);
  if (outcome.kind === "race") throw AppError.offerConcurrencyConflict();
  return {
    offer: toPublicOffer(outcome.offer, viewer.organizationId),
    transition: toPublicOfferTransition(outcome.transition),
    replay: false,
  };
}

/** Receiver rejects a live offer; a rejected counter revives its parent. */
export async function rejectOffer(
  viewer: DealViewer,
  dealId: string,
  offerId: string,
  body: RejectOfferBody,
  actorUserId: string,
  meta: RequestMeta,
): Promise<OfferActionResult> {
  const offer = await fetchOfferForViewer(
    dealId,
    offerId,
    viewer.organizationId,
  );
  if (offer.recipient.organizationId !== viewer.organizationId) {
    throw AppError.forbidden(
      "Only the receiving organization can reject this offer.",
    );
  }
  assertDealNegotiable(viewer.deal);

  const replay = await prisma.offerTransition.findFirst({
    where: { offerId: offer.id, requestId: body.requestId },
    orderBy: { createdAt: "asc" },
  });
  if (replay) return renderReplay(viewer, offer, replay);

  const outcome = await prisma.$transaction(async (tx) => {
    const txReplay = await tx.offerTransition.findFirst({
      where: { offerId: offer.id, requestId: body.requestId },
      orderBy: { createdAt: "asc" },
    });
    if (txReplay) return { kind: "replay" as const, transition: txReplay };

    requireOfferLegalTransition(offer.status, "REJECTED");
    if (offer.expiresAt && offer.expiresAt.getTime() <= Date.now()) {
      await markExpiredBestEffort(tx, offer, actorUserId);
      throw AppError.offerExpired();
    }

    const applied = await applyOfferTransition(
      tx,
      offer,
      "REJECTED",
      body.requestId,
      `Rejected: ${body.reason}`,
      actorUserId,
    );
    if (!applied.offer) return { kind: "race" as const };

    if (offer.parentOfferId) {
      const parent = await tx.offer.findFirst({
        where: { id: offer.parentOfferId },
      });
      if (parent) {
        await reactivateParentOnReject(tx, parent, actorUserId, body.requestId);
      }
    }

    await writeSecurityEvent(tx, {
      type: SecurityEventType.OFFER_REJECTED,
      userId: actorUserId,
      organizationId: viewer.organizationId,
      metadata: {
        offerId: offer.id,
        dealId,
        requestId: body.requestId,
        reason: body.reason,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      kind: "changed" as const,
      offer: applied.offer,
      transition: applied.transition,
    };
  });

  if (outcome.kind === "replay")
    return renderReplay(viewer, offer, outcome.transition);
  if (outcome.kind === "race") throw AppError.offerConcurrencyConflict();
  return {
    offer: toPublicOffer(outcome.offer, viewer.organizationId),
    transition: toPublicOfferTransition(outcome.transition),
    replay: false,
  };
}

/** Sender withdraws a DRAFT or SUBMITTED offer (never a countered one). */
export async function withdrawOffer(
  viewer: DealViewer,
  dealId: string,
  offerId: string,
  body: WithdrawOfferBody,
  actorUserId: string,
  meta: RequestMeta,
): Promise<OfferActionResult> {
  const offer = await fetchOfferForViewer(
    dealId,
    offerId,
    viewer.organizationId,
  );
  if (offer.createdBy.organizationId !== viewer.organizationId) {
    throw AppError.forbidden(
      "Only the sending organization can withdraw this offer.",
    );
  }
  assertDealNegotiable(viewer.deal);

  const replay = await prisma.offerTransition.findFirst({
    where: { offerId: offer.id, requestId: body.requestId },
    orderBy: { createdAt: "asc" },
  });
  if (replay) return renderReplay(viewer, offer, replay);

  const outcome = await prisma.$transaction(async (tx) => {
    const txReplay = await tx.offerTransition.findFirst({
      where: { offerId: offer.id, requestId: body.requestId },
      orderBy: { createdAt: "asc" },
    });
    if (txReplay) return { kind: "replay" as const, transition: txReplay };

    requireOfferLegalTransition(offer.status, "WITHDRAWN");

    const applied = await applyOfferTransition(
      tx,
      offer,
      "WITHDRAWN",
      body.requestId,
      offerReasonOf("OFFER_WITHDRAWN"),
      actorUserId,
    );
    if (!applied.offer) return { kind: "race" as const };

    await writeSecurityEvent(tx, {
      type: SecurityEventType.OFFER_WITHDRAWN,
      userId: actorUserId,
      organizationId: viewer.organizationId,
      metadata: { offerId: offer.id, dealId, requestId: body.requestId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      kind: "changed" as const,
      offer: applied.offer,
      transition: applied.transition,
    };
  });

  if (outcome.kind === "replay")
    return renderReplay(viewer, offer, outcome.transition);
  if (outcome.kind === "race") throw AppError.offerConcurrencyConflict();
  return {
    offer: toPublicOffer(outcome.offer, viewer.organizationId),
    transition: toPublicOfferTransition(outcome.transition),
    replay: false,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Paginated offers visible to the viewer's org (sender or receiver). */
export async function listOffers(
  viewer: DealViewer,
  dealId: string,
  query: OfferQuery,
): Promise<{
  offers: PublicOffer[];
  total: number;
  page: number;
  limit: number;
}> {
  const where: Prisma.OfferWhereInput = {
    dealId,
    ...(query.status ? { status: query.status } : {}),
    OR: [
      { createdBy: { organizationId: viewer.organizationId } },
      { recipient: { organizationId: viewer.organizationId } },
    ],
  };
  const skip = (query.page - 1) * query.limit;
  const [rows, total] = await prisma.$transaction([
    prisma.offer.findMany({
      where,
      include: OFFER_PARTY_INCLUDE,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take: query.limit,
    }),
    prisma.offer.count({ where }),
  ]);
  return {
    offers: rows.map((row) => toPublicOffer(row, viewer.organizationId)),
    total,
    page: query.page,
    limit: query.limit,
  };
}

export async function getOffer(
  viewer: DealViewer,
  dealId: string,
  offerId: string,
): Promise<PublicOffer> {
  const offer = await fetchOfferForViewer(
    dealId,
    offerId,
    viewer.organizationId,
  );
  return toPublicOffer(offer, viewer.organizationId);
}

/**
 * Negotiation history: the immutable OfferTransition ledger, filtered to
 * offers the viewer's org is a party to (confidential by construction).
 */
export async function getNegotiation(
  viewer: DealViewer,
  dealId: string,
  query: NegotiationQuery,
): Promise<{
  events: PublicNegotiationEvent[];
  total: number;
  limit: number;
  offset: number;
}> {
  const where: Prisma.OfferTransitionWhereInput = {
    dealId,
    offer: {
      OR: [
        { createdBy: { organizationId: viewer.organizationId } },
        { recipient: { organizationId: viewer.organizationId } },
      ],
    },
  };
  const [rows, total] = await prisma.$transaction([
    prisma.offerTransition.findMany({
      where,
      include: { offer: { include: OFFER_PARTY_INCLUDE } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: query.offset,
      take: query.limit,
    }),
    prisma.offerTransition.count({ where }),
  ]);
  return {
    events: rows.map((row) =>
      toPublicNegotiationEvent(row, viewer.organizationId),
    ),
    total,
    limit: query.limit,
    offset: query.offset,
  };
}

// ---------------------------------------------------------------------------
// Expiry worker
// ---------------------------------------------------------------------------

export const OFFER_EXPIRABLE_STATUSES: readonly OfferStatus[] = [
  "SUBMITTED",
  "COUNTERED",
];

/**
 * System worker: lazily expires SUBMITTED/COUNTERED offers whose deadline has
 * passed. Safe to run concurrently and to re-run (conditional updates win, the
 * rest is skipped). Returns the number of offers newly expired.
 */
export async function expireEligibleOffers(
  now: Date = new Date(),
  batchSize = 100,
): Promise<number> {
  const candidates = await prisma.offer.findMany({
    where: {
      expiresAt: { lt: now },
      status: { in: [...OFFER_EXPIRABLE_STATUSES] },
    },
    select: {
      id: true,
      dealId: true,
      status: true,
      version: true,
      expiresAt: true,
      createdBy: { select: { organizationId: true } },
    },
    take: batchSize,
  });

  let expired = 0;
  for (const candidate of candidates) {
    try {
      const changed = await prisma.$transaction(async (tx) => {
        const applied = await tx.offer.updateMany({
          where: {
            id: candidate.id,
            status: candidate.status,
            version: candidate.version,
          },
          data: { status: "EXPIRED", version: { increment: 1 } },
        });
        if (applied.count === 0) return false;
        await tx.offerTransition.create({
          data: {
            offerId: candidate.id,
            dealId: candidate.dealId,
            requestId: null,
            transitionType: "OFFER_EXPIRED",
            fromStatus: candidate.status,
            toStatus: "EXPIRED",
            reason:
              `System expiry: offer deadline passed ` +
              `(${candidate.expiresAt?.toISOString() ?? "unknown"}).`,
            actorUserId: null,
          },
        });
        await writeSecurityEvent(tx, {
          type: SecurityEventType.OFFER_EXPIRED,
          userId: undefined,
          organizationId: candidate.createdBy.organizationId,
          metadata: {
            offerId: candidate.id,
            dealId: candidate.dealId,
            fromStatus: candidate.status,
            reason: "Offer deadline passed.",
          },
          ipAddress: null,
          userAgent: null,
        });
        return true;
      });
      if (changed) expired += 1;
    } catch {
      // Best effort: skip a contended row this pass.
    }
  }
  return expired;
}
