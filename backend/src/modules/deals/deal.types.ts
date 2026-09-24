import { Prisma, type Deal, type DealStateTransition } from "@prisma/client";
import type { DealStatus, DealType } from "./deal-state.js";
import { currencyInfo } from "./deal.schemas.js";

/**
 * Wire-level deal shape. Money leaves the API as strings (never JSON floats),
 * timestamps as RFC 3339, and `version` drives optimistic concurrency on
 * update/transition so a stale client write is rejected with 409 — never
 * silently clobbered.
 */
export interface PublicDeal {
  id: string;
  organizationId: string;
  createdByUserId: string;
  reference: string;
  type: DealType;
  status: DealStatus;
  name: string;
  description: string | null;
  currency: string;
  notionalAmount: string;
  settledAmount: string | null;
  settlementDate: string | null;
  expiresAt: string | null;
  metadata: Record<string, unknown> | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * A single immutable state-transition record (the audit trail). `requestId`
 * is the idempotency key: retrying a transition reuses the same row instead
 * of appending a duplicate.
 */
export interface PublicDealTransition {
  id: string;
  dealId: string;
  organizationId: string;
  requestId: string | null;
  transitionType: string;
  fromStatus: DealStatus;
  toStatus: DealStatus;
  reason: string | null;
  /** Null for system-initiated transitions (e.g. the expiry worker). */
  actorUserId: string | null;
  createdAt: string;
}

export interface PublicDealPage {
  deals: PublicDeal[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Canonical wire form for a stored money amount: fixed decimals at the
 * currency's ISO 4217 minor-unit precision, so "1250000.50000000" always
 * leaves as "1250000.50" (USD) and never drifts in client-side rounding.
 */
function serializeMoney(amount: Prisma.Decimal, currency: string): string {
  const { minor } = currencyInfo(currency);
  return amount.toFixed(minor);
}

/** Serializes a Prisma Deal (Decimal money columns) for the wire. */
export function toPublicDeal(deal: Deal): PublicDeal {
  return {
    id: deal.id,
    organizationId: deal.organizationId,
    createdByUserId: deal.createdByUserId,
    reference: deal.reference,
    type: deal.type,
    status: deal.status,
    name: deal.name,
    description: deal.description,
    currency: deal.currency,
    notionalAmount: serializeMoney(deal.notionalAmount, deal.currency),
    settledAmount: deal.settledAmount
      ? serializeMoney(deal.settledAmount, deal.currency)
      : null,
    settlementDate: deal.settlementDate?.toISOString() ?? null,
    expiresAt: deal.expiresAt?.toISOString() ?? null,
    metadata: deal.metadata as Record<string, unknown> | null,
    version: deal.version,
    createdAt: deal.createdAt.toISOString(),
    updatedAt: deal.updatedAt.toISOString(),
  };
}

/** Serializes a Prisma DealStateTransition for the wire. */
export function toPublicDealTransition(
  transition: DealStateTransition,
): PublicDealTransition {
  return {
    id: transition.id,
    dealId: transition.dealId,
    organizationId: transition.organizationId,
    requestId: transition.requestId,
    transitionType: transition.transitionType,
    fromStatus: transition.fromStatus,
    toStatus: transition.toStatus,
    reason: transition.reason,
    actorUserId: transition.actorUserId,
    createdAt: transition.createdAt.toISOString(),
  };
}
