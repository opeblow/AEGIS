import type { Deal, DealParticipant } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors/index.js";
import { Permissions } from "../organizations/permissions.js";

/**
 * Participant-level authorization for ALL deal-scoped APIs (Phase 5).
 *
 * Aegis is organization-first: a user acts in a deal as the organization they
 * are an ACTIVE member of AND that holds a DealParticipant row. Resolution:
 *
 *   authenticate user -> ACTIVE membership(s) -> DealParticipant of that org
 *   in the deal -> participant status/type gates the operation.
 *
 * The deal is resolved BEFORE membership so that only involved users even
 * learn whether a deal id exists (confidentiality: a stranger gets the same
 * DEAL_PARTICIPANT_NOT_FOUND as a bad id).
 */
export interface DealViewer {
  deal: Deal;
  participant: DealParticipant;
  /** The organization the requester acts as inside this deal. */
  organizationId: string;
  isOwner: boolean;
}

export async function resolveDealViewer(
  dealId: string,
  userId: string,
  opts: { requireActive?: boolean } = {},
): Promise<DealViewer> {
  const deal = await prisma.deal.findFirst({ where: { id: dealId } });
  if (!deal) throw AppError.dealParticipantNotFound();

  const memberships = await prisma.organizationMember.findMany({
    where: {
      userId,
      status: "ACTIVE",
      organization: { status: "ACTIVE" },
    },
    select: { organizationId: true },
  });
  const organizationIds = memberships.map((m) => m.organizationId);
  if (organizationIds.length === 0) throw AppError.dealParticipantNotFound();

  const participants = await prisma.dealParticipant.findMany({
    where: { dealId, organizationId: { in: organizationIds } },
  });
  if (participants.length === 0) throw AppError.dealParticipantNotFound();

  // A user may technically hold memberships in several participant orgs.
  // Prefer the OWNER row (the deal creator org is the natural acting org),
  // otherwise the earliest-created participant row. Documented for MVP: a
  // user acts within a deal via exactly one org.
  const participant =
    participants.find((p) => p.participantType === "OWNER") ??
    participants.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    )[0];

  if (opts.requireActive !== false && participant.status !== "ACTIVE") {
    throw AppError.dealParticipantNotActive(
      `Your participation in this deal is ${participant.status}. It must be ACTIVE.`,
    );
  }

  return {
    deal,
    participant,
    organizationId: participant.organizationId,
    isOwner: participant.participantType === "OWNER",
  };
}

/** Owner-only guard for participant management endpoints. */
export function requireOwnerViewer(viewer: DealViewer): DealViewer {
  if (!viewer.isOwner) {
    throw AppError.forbidden(
      "Only the deal owner organization can perform this action.",
    );
  }
  return viewer;
}

/** The deals permission that governs owner-side participant management. */
export const ParticipantManagementPermission = Permissions.DealsUpdate;
