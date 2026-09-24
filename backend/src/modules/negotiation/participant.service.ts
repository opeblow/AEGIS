import type {
  DealParticipant,
  DealParticipantInvitation,
  Organization,
} from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors/index.js";
import { generateToken, hashToken } from "../auth/tokens.js";
import { normalizeEmail } from "../auth/user.service.js";
import { devEmailService } from "../auth/email.service.js";
import {
  SecurityEventType,
  writeSecurityEvent,
} from "../auth/security-events.js";
import type { RequestMeta } from "../organizations/organization.service.js";
import { getEnv } from "../../config/env.js";
import {
  isParticipantTransitionLegal,
  participantReasonOf,
  participantTransitionTypeFor,
  type DealParticipantStatus,
} from "./offer-state.js";
import {
  dealInvitationState,
  toPublicDealInvitation,
  toPublicDealParticipant,
  type DealInvitationState,
  type PublicDealInvitation,
  type PublicDealParticipant,
} from "./negotiation.types.js";
import type {
  InviteParticipantBody,
  ParticipantStatusBody,
} from "./negotiation.schemas.js";
import type { DealViewer } from "./participant-policy.js";
import {
  isTerminalStatus,
  type DealStatus,
  type DealType,
} from "../deals/deal-state.js";

type InvitationRow = DealParticipantInvitation & {
  deal?: {
    id: string;
    reference: string;
    name: string;
    type: DealType;
    status: DealStatus;
  };
  organization?: Organization;
  participant?: DealParticipant | null;
};

export interface InvitationLookup {
  invitation: InvitationRow;
  state: DealInvitationState;
}

/** Cap the number of concurrent pending invitations per org in one deal. */
const MAX_PENDING_PER_PARTICIPANT = 1;

/**
 * Opens a deal to a new organization. A DealParticipant row is pre-created in
 * INVITED state (single row per deal+org → double invites are impossible) and
 * a token-hash-only invitation is issued. ONLY the owner org (with
 * deals:update) may invite — enforced by the route; participant-level checks
 * here are defense in depth.
 */
export async function inviteToDeal(
  viewer: DealViewer,
  dealId: string,
  body: InviteParticipantBody,
  actorUserId: string,
  meta: RequestMeta,
): Promise<PublicDealInvitation> {
  const email = normalizeEmail(body.email);
  const participantType = body.participantType;

  const target = await prisma.organization.findFirst({
    where: { id: body.organizationId, status: "ACTIVE" },
    select: { id: true, name: true, slug: true },
  });
  if (!target) {
    throw AppError.dealParticipantNotFound("Organization not found.");
  }
  if (target.id === viewer.organizationId) {
    throw AppError.dealParticipantExists(
      "The deal owner organization is already a participant.",
    );
  }

  const existing = await prisma.dealParticipant.findFirst({
    where: { dealId, organizationId: target.id },
    include: { invitations: true },
  });
  if (
    existing &&
    existing.status !== "DECLINED" &&
    existing.status !== "REMOVED"
  ) {
    throw AppError.dealParticipantExists();
  }

  const now = new Date();
  const rawToken = generateToken();
  const expiresAt = new Date(now.getTime() + getEnv().ORG_INVITATION_TTL_MS);

  const created = await prisma.$transaction(async (tx) => {
    let participant: DealParticipant;
    if (existing) {
      const existingInvites = existing.invitations ?? [];
      const pending = existingInvites.filter(
        (inv) => !inv.revokedAt && !inv.acceptedAt && !inv.declinedAt,
      );
      if (pending.length >= MAX_PENDING_PER_PARTICIPANT) {
        throw AppError.dealParticipantExists(
          "A pending invitation already exists for this organization.",
        );
      }
      participant = await tx.dealParticipant.update({
        where: { id: existing.id },
        data: {
          participantType,
          status: "INVITED",
          invitedByUserId: actorUserId,
          version: { increment: 1 },
        },
      });
      await tx.dealParticipantTransition.create({
        data: {
          dealParticipantId: participant.id,
          dealId,
          organizationId: target.id,
          requestId: null,
          transitionType: "PARTICIPANT_INVITED",
          fromStatus: existing.status,
          toStatus: "INVITED",
          reason: "Deal invitation re-sent.",
          actorUserId,
        },
      });
    } else {
      participant = await tx.dealParticipant.create({
        data: {
          dealId,
          organizationId: target.id,
          participantType,
          status: "INVITED",
          invitedByUserId: actorUserId,
          version: 1,
        },
      });
      await tx.dealParticipantTransition.create({
        data: {
          dealParticipantId: participant.id,
          dealId,
          organizationId: target.id,
          requestId: null,
          transitionType: "PARTICIPANT_INVITED",
          fromStatus: "INVITED",
          toStatus: "INVITED",
          reason: "Deal invitation sent.",
          actorUserId,
        },
      });
    }

    const invitation = await tx.dealParticipantInvitation.create({
      data: {
        dealId,
        organizationId: target.id,
        participantId: participant.id,
        email,
        participantType,
        tokenHash: hashToken(rawToken),
        invitedByUserId: actorUserId,
        createdAt: now,
        expiresAt,
      },
    });

    await writeSecurityEvent(tx, {
      type: SecurityEventType.DEAL_PARTICIPANT_INVITED,
      userId: actorUserId,
      organizationId: viewer.organizationId,
      metadata: {
        dealId,
        invitedOrganizationId: target.id,
        email,
        participantType,
        invitationId: invitation.id,
        expiresAt: expiresAt.toISOString(),
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { invitation, participant };
  });

  // Deliver the raw token through the dev email channel only (never stored).
  await devEmailService.sendDealParticipantInvitation(
    email,
    rawToken,
    viewer.deal.name,
    viewer.deal.reference,
    participantType,
  );

  return toPublicDealInvitation({
    ...created.invitation,
    deal: {
      id: viewer.deal.id,
      reference: viewer.deal.reference,
      name: viewer.deal.name,
      type: viewer.deal.type,
      status: viewer.deal.status,
    },
    organization: { ...target, slug: target.slug ?? "" },
  });
}

/** Lists invitations (owner org only — enforced by the route). */
export async function listInvitations(
  _viewer: DealViewer,
  dealId: string,
): Promise<PublicDealInvitation[]> {
  const rows = await prisma.dealParticipantInvitation.findMany({
    where: { dealId },
    include: { organization: true, deal: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return rows.map(toPublicDealInvitation);
}

/** Owner revokes a pending invitation (or a reactivated INVITED row). */
export async function revokeInvitation(
  viewer: DealViewer,
  dealId: string,
  invitationId: string,
  actorUserId: string,
  meta: RequestMeta,
): Promise<PublicDealInvitation> {
  const invitation = await prisma.dealParticipantInvitation.findFirst({
    where: { id: invitationId, dealId },
    include: { organization: true, deal: true },
  });
  if (!invitation) throw AppError.dealParticipantNotFound();
  if (invitation.acceptedAt) throw AppError.dealInvitationAlreadyUsed();
  if (invitation.revokedAt) {
    return toPublicDealInvitation(invitation); // idempotent revoke
  }

  const updated = await prisma.$transaction(async (tx) => {
    const revoked = await tx.dealParticipantInvitation.update({
      where: { id: invitation.id },
      data: { revokedAt: new Date() },
      include: { organization: true, deal: true },
    });

    if (invitation.participantId) {
      const participant = await tx.dealParticipant.findFirst({
        where: { id: invitation.participantId },
      });
      if (participant && participant.status === "INVITED") {
        await tx.dealParticipant.update({
          where: { id: participant.id },
          data: { status: "REMOVED", version: { increment: 1 } },
        });
        await tx.dealParticipantTransition.create({
          data: {
            dealParticipantId: participant.id,
            dealId,
            organizationId: invitation.organizationId,
            requestId: null,
            transitionType: "PARTICIPANT_REMOVED",
            fromStatus: "INVITED",
            toStatus: "REMOVED",
            reason: "Deal invitation revoked by the deal owner.",
            actorUserId,
          },
        });
      }
    }

    return revoked;
  });

  await writeSecurityEvent(prisma, {
    type: SecurityEventType.DEAL_PARTICIPANT_INVITATION_REVOKED,
    userId: actorUserId,
    organizationId: viewer.organizationId,
    metadata: {
      dealId,
      invitedOrganizationId: invitation.organizationId,
      invitationId: invitation.id,
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return toPublicDealInvitation(updated);
}

/** Token lookup (the raw token is the credential — hash-only, generic failure). */
export async function getDealInvitationByToken(
  rawToken: string,
): Promise<InvitationLookup | null> {
  const invitation = await prisma.dealParticipantInvitation.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: {
      organization: true,
      deal: true,
      participant: true,
    },
  });
  if (!invitation) return null;
  return { invitation, state: dealInvitationState(invitation) };
}

function assertAcceptableInvitationState(
  state: DealInvitationState | null,
): void {
  if (state === null) {
    throw AppError.validation("Invalid or expired invitation.");
  }
  switch (state) {
    case "ACCEPTED":
    case "DECLINED":
      throw AppError.dealInvitationAlreadyUsed();
    case "REVOKED":
      throw AppError.dealInvitationRevoked();
    case "EXPIRED":
      throw AppError.dealInvitationExpired();
    case "PENDING":
      return;
  }
}

/**
 * Entry gate for the token routes. ACCEPTED/DECLINED pass through so that the
 * in-transaction replay branches can answer idempotently; REVOKED and EXPIRED
 * are hard failures.
 */
function assertInvitationUsable(state: DealInvitationState | null): void {
  if (state === null) {
    throw AppError.validation("Invalid or expired invitation.");
  }
  if (state === "REVOKED") throw AppError.dealInvitationRevoked();
  if (state === "EXPIRED") throw AppError.dealInvitationExpired();
}

interface AcceptResponse {
  participant: PublicDealParticipant;
  organization: { id: string; name: string; slug: string };
  deal: {
    id: string;
    reference: string;
    name: string;
    type: string;
    status: DealStatus;
  };
}

/**
 * Accepts a deal invitation for the authenticated user's organization.
 * Guards: email-verified account, normalized-email match, ACTIVE membership in
 * the invited organization, deal not terminal, participant still INVITED.
 * The accept is single-use and atomic; a retry after success is idempotent.
 */
export async function acceptDealInvitation(
  rawToken: string,
  actor: { userId: string; email: string; emailVerified: boolean },
  meta: RequestMeta,
): Promise<AcceptResponse> {
  const lookup = await getDealInvitationByToken(rawToken);
  if (!lookup) {
    throw AppError.validation("Invalid or expired invitation.");
  }
  assertInvitationUsable(lookup.state);
  const { invitation } = lookup;

  if (!actor.emailVerified) {
    throw AppError.forbidden(
      "Verify your email address before joining a deal.",
    );
  }
  if (normalizeEmail(actor.email) !== invitation.email) {
    throw AppError.forbidden(
      "This invitation was sent to a different email address.",
    );
  }

  const membership = await prisma.organizationMember.findFirst({
    where: {
      organizationId: invitation.organizationId,
      userId: actor.userId,
    },
    select: { status: true },
  });
  if (!membership || membership.status === "REMOVED") {
    throw AppError.forbidden(
      "Join this organization on Aegis before accepting its deal invitation.",
    );
  }
  if (membership.status === "SUSPENDED") throw AppError.membershipSuspended();
  if (membership.status !== "ACTIVE") {
    throw AppError.forbidden(
      "Your membership in this organization is not active.",
    );
  }

  const deal = invitation.deal;
  if (deal && isTerminalStatus(deal.status as DealStatus)) {
    throw AppError.invalidDealState(
      "This deal is no longer accepting participants.",
    );
  }

  return prisma.$transaction(async (tx) => {
    const fresh = await tx.dealParticipantInvitation.findUnique({
      where: { id: invitation.id },
      include: {
        organization: true,
        deal: true,
        participant: true,
      },
    });
    if (!fresh || fresh.acceptedAt) {
      if (fresh?.participant) {
        const p = fresh.participant;
        const existing = await tx.dealParticipant.findFirst({
          where: { id: p.id },
          include: { organization: true },
        });
        if (existing && existing.status === "ACTIVE" && fresh.acceptedAt) {
          // Idempotent replay of an already-applied accept.
          return buildAcceptResponse(existing);
        }
      }
      throw AppError.dealInvitationAlreadyUsed();
    }
    assertAcceptableInvitationState(dealInvitationState(fresh));

    const participant = await tx.dealParticipant.findFirst({
      where: { id: fresh.participantId ?? "" },
      include: { organization: true },
    });
    if (!participant) {
      throw AppError.dealParticipantNotFound("Deal not found.");
    }

    await tx.dealParticipant.update({
      where: { id: participant.id },
      data: {
        status: "ACTIVE",
        joinedAt: new Date(),
        version: { increment: 1 },
      },
    });
    await tx.dealParticipantTransition.create({
      data: {
        dealParticipantId: participant.id,
        dealId: participant.dealId,
        organizationId: participant.organizationId,
        requestId: null,
        transitionType: "PARTICIPANT_JOINED",
        fromStatus: "INVITED",
        toStatus: "ACTIVE",
        reason: participantReasonOf("ACTIVE"),
        actorUserId: actor.userId,
      },
    });
    await tx.dealParticipantInvitation.update({
      where: { id: fresh.id },
      data: { acceptedAt: new Date() },
    });

    await writeSecurityEvent(tx, {
      type: SecurityEventType.DEAL_PARTICIPANT_JOINED,
      userId: actor.userId,
      organizationId: invitation.organizationId,
      metadata: {
        dealId: participant.dealId,
        participantId: participant.id,
        organizationId: participant.organizationId,
        invitationId: fresh.id,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    const joined = await tx.dealParticipant.findFirst({
      where: { id: participant.id },
      include: { organization: true },
    });
    return buildAcceptResponse(joined ?? participant);
  });
}

function buildAcceptResponse(
  participant: DealParticipant & { organization?: Organization },
): AcceptResponse {
  return {
    participant: toPublicDealParticipant(participant),
    organization: {
      id: participant.organizationId,
      name: participant.organization?.name ?? "Organization",
      slug: participant.organization?.slug ?? "",
    },
    deal: {
      id: participant.dealId,
      reference: "",
      name: "Deal",
      type: "OTHER",
      status: "DRAFT",
    },
  };
}

/** Declines a deal invitation (participant stays DECLINED; single-use token). */
export async function declineDealInvitation(
  rawToken: string,
  actor: { userId: string; email: string; emailVerified: boolean },
  meta: RequestMeta,
): Promise<{ participant: PublicDealParticipant }> {
  const lookup = await getDealInvitationByToken(rawToken);
  if (!lookup) throw AppError.validation("Invalid or expired invitation.");
  assertInvitationUsable(lookup.state);
  const { invitation } = lookup;

  if (!actor.emailVerified) {
    throw AppError.forbidden(
      "Verify your email address before using an invitation.",
    );
  }
  if (normalizeEmail(actor.email) !== invitation.email) {
    throw AppError.forbidden(
      "This invitation was sent to a different email address.",
    );
  }

  return prisma.$transaction(async (tx) => {
    const fresh = await tx.dealParticipantInvitation.findUnique({
      where: { id: invitation.id },
    });
    if (!fresh) throw AppError.validation("Invalid or expired invitation.");
    if (fresh.declinedAt) {
      // Idempotent replay: already declined.
      const p = await tx.dealParticipant.findFirst({
        where: { id: fresh.participantId ?? "" },
        include: { organization: true },
      });
      if (p) return { participant: toPublicDealParticipant(p) };
      throw AppError.dealInvitationAlreadyUsed();
    }
    assertAcceptableInvitationState(dealInvitationState(fresh));

    const participant = await tx.dealParticipant.findFirst({
      where: { id: fresh.participantId ?? "" },
      include: { organization: true },
    });
    if (!participant || participant.status !== "INVITED") {
      throw AppError.dealInvitationAlreadyUsed();
    }

    await tx.dealParticipant.update({
      where: { id: participant.id },
      data: { status: "DECLINED", version: { increment: 1 } },
    });
    await tx.dealParticipantTransition.create({
      data: {
        dealParticipantId: participant.id,
        dealId: participant.dealId,
        organizationId: participant.organizationId,
        requestId: null,
        transitionType: "PARTICIPANT_DECLINED",
        fromStatus: "INVITED",
        toStatus: "DECLINED",
        reason: participantReasonOf("DECLINED"),
        actorUserId: actor.userId,
      },
    });
    await tx.dealParticipantInvitation.update({
      where: { id: fresh.id },
      data: { declinedAt: new Date() },
    });

    await writeSecurityEvent(tx, {
      type: SecurityEventType.DEAL_PARTICIPANT_DECLINED,
      userId: actor.userId,
      organizationId: invitation.organizationId,
      metadata: {
        dealId: participant.dealId,
        participantId: participant.id,
        invitationId: fresh.id,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    const declined = await tx.dealParticipant.findFirst({
      where: { id: participant.id },
      include: { organization: true },
    });
    return { participant: toPublicDealParticipant(declined ?? participant) };
  });
}

/**
 * Owner manages a participant's lifecycle: SUSPENDED / REACTIVATED (-> ACTIVE)
 * / REMOVED. The OWNER participant is immutable. Optimistic concurrency via
 * `version`; requestId (when supplied) deduplicates replayed requests.
 */
export async function updateParticipantStatus(
  viewer: DealViewer,
  dealId: string,
  participantId: string,
  body: ParticipantStatusBody,
  actorUserId: string,
  meta: RequestMeta,
): Promise<PublicDealParticipant> {
  const target = await prisma.dealParticipant.findFirst({
    where: { id: participantId, dealId },
    include: { organization: true },
  });
  if (!target) throw AppError.dealParticipantNotFound();

  if (target.participantType === "OWNER") {
    throw AppError.dealParticipantOwnerImmutable(
      "The deal owner participant cannot be suspended, removed, or reactivated.",
    );
  }

  const toStatus: DealParticipantStatus =
    body.status === "REACTIVATED" ? "ACTIVE" : body.status;
  // A no-op move (the participant is already in the target state) is a replay,
  // not a transition: it is answered idempotently below, so the from===to
  // legality check must not reject it.
  if (
    toStatus !== target.status &&
    !isParticipantTransitionLegal(target.status, toStatus)
  ) {
    throw AppError.counterpartyInvalidTransition(
      `Invalid participant transition: ${target.status} -> ${toStatus}.`,
    );
  }

  return prisma.$transaction(async (tx) => {
    if (body.requestId) {
      const existing = await tx.dealParticipantTransition.findFirst({
        where: { dealParticipantId: target.id, requestId: body.requestId },
        orderBy: { createdAt: "asc" },
      });
      if (existing) {
        if (existing.toStatus !== toStatus) {
          throw AppError.dealParticipantIdempotencyConflict(
            "This participant status request id was used for a different change.",
          );
        }
        const p = await tx.dealParticipant.findFirst({
          where: { id: target.id },
          include: { organization: true },
        });
        if (p?.status === toStatus) {
          return toPublicDealParticipant(p);
        }
        throw AppError.dealParticipantVersionConflict();
      }
    }

    if (toStatus === target.status) {
      const fresh = await tx.dealParticipant.findFirst({
        where: { id: target.id },
        include: { organization: true },
      });
      return toPublicDealParticipant(fresh ?? target);
    }

    const applied = await tx.dealParticipant.updateMany({
      where: { id: target.id, status: target.status, version: body.version },
      data: { status: toStatus, version: { increment: 1 } },
    });
    if (applied.count === 0) {
      const latest = await tx.dealParticipant.findFirst({
        where: { id: target.id },
        include: { organization: true },
      });
      if (!latest) throw AppError.dealParticipantNotFound();
      if (latest.status === toStatus) {
        // Replay corner: requestId-less retry after success.
        return toPublicDealParticipant(latest);
      }
      throw AppError.dealParticipantVersionConflict();
    }

    await tx.dealParticipantTransition.create({
      data: {
        dealParticipantId: target.id,
        dealId,
        organizationId: target.organizationId,
        requestId: body.requestId ?? null,
        transitionType: participantTransitionTypeFor(toStatus),
        fromStatus: target.status,
        toStatus,
        reason: participantReasonOf(toStatus),
        actorUserId,
      },
    });

    const eventType =
      toStatus === "SUSPENDED"
        ? SecurityEventType.DEAL_PARTICIPANT_SUSPENDED
        : toStatus === "ACTIVE"
          ? SecurityEventType.DEAL_PARTICIPANT_REACTIVATED
          : SecurityEventType.DEAL_PARTICIPANT_REMOVED;
    await writeSecurityEvent(tx, {
      type: eventType,
      userId: actorUserId,
      organizationId: viewer.organizationId,
      metadata: {
        dealId,
        participantId: target.id,
        fromStatus: target.status,
        toStatus,
        organizationId: target.organizationId,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    const participant = await tx.dealParticipant.findFirst({
      where: { id: target.id },
      include: { organization: true },
    });
    return toPublicDealParticipant(participant ?? target);
  });
}

/**
 * Participant listing. The owner org sees the full roster; every other org
 * sees only its own row (participant list confidentiality).
 */
export async function listParticipants(
  viewer: DealViewer,
  dealId: string,
): Promise<{ participants: PublicDealParticipant[]; total: number }> {
  if (viewer.isOwner) {
    const rows = await prisma.dealParticipant.findMany({
      where: { dealId },
      include: { organization: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return {
      participants: rows.map(toPublicDealParticipant),
      total: rows.length,
    };
  }
  const own = await prisma.dealParticipant.findFirst({
    where: { id: viewer.participant.id, dealId },
    include: { organization: true },
  });
  const list = own ? [toPublicDealParticipant(own)] : [];
  return { participants: list, total: list.length };
}

export { toPublicDealInvitation };
