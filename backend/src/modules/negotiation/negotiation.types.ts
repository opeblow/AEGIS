import {
  Prisma,
  type CounterpartyStatus,
  type CounterpartyVerificationStatus,
  type Deal,
  type DealParticipant,
  type DealParticipantInvitation,
  type DealParticipantType,
  type Offer,
  type OfferTransition,
  type Organization,
  type OrganizationCounterparty,
} from "@prisma/client";
import type { DealType, DealStatus } from "../deals/deal-state.js";
import type { DealParticipantStatus, OfferStatus } from "./offer-state.js";
import { currencyInfo } from "../deals/deal.schemas.js";

// ---------------------------------------------------------------------------
// Counterparties
// ---------------------------------------------------------------------------

export interface PublicCounterparty {
  id: string;
  /**
   * Direction relative to the organization performing the query:
   * "outgoing" = this org initiated the relationship, "incoming" = the other
   * org initiated it.
   */
  relationshipDirection: "outgoing" | "incoming";
  organizationId: string;
  counterpartyOrganizationId: string;
  counterparty: {
    id: string;
    name: string;
    legalName: string | null;
    country: string | null;
  };
  status: CounterpartyStatus;
  verificationStatus: CounterpartyVerificationStatus;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export function toPublicCounterparty(
  row: OrganizationCounterparty & {
    organization?: Organization;
    counterpartyOrganization?: Organization;
  },
  viewerOrganizationId: string,
): PublicCounterparty {
  // Direction is relative to the viewer: the counterparty is always the OTHER
  // organization in the (shared, normalized) relationship row.
  const outgoing = row.organizationId === viewerOrganizationId;
  const otherOrg = outgoing ? row.counterpartyOrganization : row.organization;
  return {
    id: row.id,
    relationshipDirection: outgoing ? "outgoing" : "incoming",
    organizationId: row.organizationId,
    counterpartyOrganizationId: row.counterpartyOrganizationId,
    counterparty: {
      id: outgoing ? row.counterpartyOrganizationId : row.organizationId,
      name: otherOrg?.name ?? "Counterparty",
      legalName: otherOrg?.legalName ?? null,
      country: otherOrg?.country ?? null,
    },
    status: row.status,
    verificationStatus: row.verificationStatus,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface PublicCounterpartyPage {
  counterparties: PublicCounterparty[];
  total: number;
  page: number;
  limit: number;
}

// ---------------------------------------------------------------------------
// Deal participants & invitations
// ---------------------------------------------------------------------------

export interface PublicDealParticipant {
  id: string;
  dealId: string;
  organizationId: string;
  organization: { id: string; name: string; slug: string };
  participantType: DealParticipantType;
  status: DealParticipantStatus;
  invitedByUserId: string | null;
  joinedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function toPublicDealParticipant(
  row: DealParticipant & { organization?: Organization },
): PublicDealParticipant {
  return {
    id: row.id,
    dealId: row.dealId,
    organizationId: row.organizationId,
    organization: {
      id: row.organizationId,
      name: row.organization?.name ?? "Unknown organization",
      slug: row.organization?.slug ?? "",
    },
    participantType: row.participantType,
    status: row.status,
    invitedByUserId: row.invitedByUserId,
    joinedAt: row.joinedAt?.toISOString() ?? null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type DealInvitationState =
  "PENDING" | "ACCEPTED" | "DECLINED" | "REVOKED" | "EXPIRED";

export function dealInvitationState(
  row: DealParticipantInvitation,
): DealInvitationState {
  if (row.acceptedAt) return "ACCEPTED";
  if (row.declinedAt) return "DECLINED";
  if (row.revokedAt) return "REVOKED";
  if (row.expiresAt.getTime() <= Date.now()) return "EXPIRED";
  return "PENDING";
}

export interface PublicDealInvitation {
  id: string;
  dealId: string;
  deal: {
    id: string;
    reference: string;
    name: string;
    type: DealType;
    status: DealStatus;
  };
  organizationId: string;
  organization: { id: string; name: string; slug: string };
  email: string;
  participantType: DealParticipantType;
  state: DealInvitationState;
  invitedByUserId: string;
  createdAt: string;
  expiresAt: string;
}

export function toPublicDealInvitation(
  row: DealParticipantInvitation & {
    organization?: Partial<Organization>;
    deal?: Partial<Deal>;
  },
): PublicDealInvitation {
  return {
    id: row.id,
    dealId: row.dealId,
    deal: {
      id: row.dealId,
      reference: row.deal?.reference ?? "",
      name: row.deal?.name ?? "Deal",
      type: row.deal?.type ?? "OTHER",
      status: row.deal?.status ?? "DRAFT",
    },
    organizationId: row.organizationId,
    organization: {
      id: row.organizationId,
      name: row.organization?.name ?? "Unknown organization",
      slug: row.organization?.slug ?? "",
    },
    email: row.email,
    participantType: row.participantType,
    state: dealInvitationState(row),
    invitedByUserId: row.invitedByUserId,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Offers & negotiation history
// ---------------------------------------------------------------------------

type OfferWithParties = Offer & {
  createdBy: { organizationId: string; organization?: Organization };
  recipient: { organizationId: string; organization?: Organization };
};

function serializeMoney(amount: Prisma.Decimal, currency: string): string {
  const { minor } = currencyInfo(currency);
  return amount.toFixed(minor);
}

export interface PublicOffer {
  id: string;
  dealId: string;
  status: OfferStatus;
  version: number;
  currency: string;
  amount: string;
  price: string | null;
  settlementDate: string | null;
  expiresAt: string | null;
  submittedAt: string | null;
  parentOfferId: string | null;
  createdByParticipantId: string;
  recipientParticipantId: string;
  createdByOrganizationId: string;
  recipientOrganizationId: string;
  createdByOrganizationName: string;
  recipientOrganizationName: string;
  /** Relative to the requesting participant's organization. */
  direction: "sent" | "received";
  createdAt: string;
  updatedAt: string;
}

export function toPublicOffer(
  row: OfferWithParties,
  viewerOrganizationId: string,
): PublicOffer {
  const sent = row.createdBy.organizationId === viewerOrganizationId;
  return {
    id: row.id,
    dealId: row.dealId,
    status: row.status,
    version: row.version,
    currency: row.currency,
    amount: serializeMoney(row.amount, row.currency),
    price: row.price ? serializeMoney(row.price, row.currency) : null,
    settlementDate: row.settlementDate?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    parentOfferId: row.parentOfferId,
    createdByParticipantId: row.createdByParticipantId,
    recipientParticipantId: row.recipientParticipantId,
    createdByOrganizationId: row.createdBy.organizationId,
    recipientOrganizationId: row.recipient.organizationId,
    createdByOrganizationName:
      row.createdBy.organization?.name ?? "Counterparty",
    recipientOrganizationName:
      row.recipient.organization?.name ?? "Counterparty",
    direction: sent ? "sent" : "received",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface PublicOfferTransition {
  id: string;
  offerId: string;
  dealId: string;
  requestId: string | null;
  transitionType: string;
  fromStatus: OfferStatus;
  toStatus: OfferStatus;
  reason: string | null;
  actorUserId: string | null;
  createdAt: string;
}

export function toPublicOfferTransition(
  row: OfferTransition,
): PublicOfferTransition {
  return {
    id: row.id,
    offerId: row.offerId,
    dealId: row.dealId,
    requestId: row.requestId,
    transitionType: row.transitionType,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    reason: row.reason,
    actorUserId: row.actorUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface PublicNegotiationEvent {
  id: string;
  offerId: string;
  transitionType: string;
  fromStatus: OfferStatus;
  toStatus: OfferStatus;
  reason: string | null;
  actorUserId: string | null;
  createdAt: string;
  offer: {
    id: string;
    status: OfferStatus;
    direction: "sent" | "received";
    currency: string;
    amount: string;
    parentOfferId: string | null;
    createdByOrganizationId: string;
    recipientOrganizationId: string;
  };
}

export function toPublicNegotiationEvent(
  row: OfferTransition & { offer: OfferWithParties },
  viewerOrganizationId: string,
): PublicNegotiationEvent {
  return {
    id: row.id,
    offerId: row.offerId,
    transitionType: row.transitionType,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    reason: row.reason,
    actorUserId: row.actorUserId,
    createdAt: row.createdAt.toISOString(),
    offer: {
      id: row.offer.id,
      status: row.offer.status,
      direction:
        row.offer.createdBy.organizationId === viewerOrganizationId
          ? "sent"
          : "received",
      currency: row.offer.currency,
      amount: serializeMoney(row.offer.amount, row.offer.currency),
      parentOfferId: row.offer.parentOfferId,
      createdByOrganizationId: row.offer.createdBy.organizationId,
      recipientOrganizationId: row.offer.recipient.organizationId,
    },
  };
}

// ---------------------------------------------------------------------------
// Deal room
// ---------------------------------------------------------------------------

export interface PublicRoomDeal {
  id: string;
  reference: string;
  type: DealType;
  status: DealStatus;
  name: string;
  description: string | null;
  currency: string;
  settlementDate: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Owner organization only — the confidential term-sheet fields. */
  notionalAmount?: string;
  settledAmount?: string | null;
  metadata?: Record<string, unknown> | null;
}

export function toPublicRoomDeal(
  deal: Deal,
  includeTerms: boolean,
): PublicRoomDeal {
  const base: PublicRoomDeal = {
    id: deal.id,
    reference: deal.reference,
    type: deal.type,
    status: deal.status,
    name: deal.name,
    description: deal.description,
    currency: deal.currency,
    settlementDate: deal.settlementDate?.toISOString() ?? null,
    expiresAt: deal.expiresAt?.toISOString() ?? null,
    createdAt: deal.createdAt.toISOString(),
    updatedAt: deal.updatedAt.toISOString(),
  };
  if (!includeTerms) return base;
  return {
    ...base,
    notionalAmount: serializeMoney(deal.notionalAmount, deal.currency),
    settledAmount: deal.settledAmount
      ? serializeMoney(deal.settledAmount, deal.currency)
      : null,
    metadata: deal.metadata as Record<string, unknown> | null,
  };
}
