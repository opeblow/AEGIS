import { createHash } from "node:crypto";
import { Prisma, type Deal, type DealStateTransition } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors/index.js";
import {
  SecurityEventType,
  writeSecurityEvent,
} from "../auth/security-events.js";
import type { RequestMeta } from "../organizations/organization.service.js";
import {
  isDeadlineExpirable,
  isLegalTransition,
  transitionReasonOf,
  transitionTypeFor,
  type DealStatus,
} from "./deal-state.js";
import {
  assertMoneyForCurrency,
  type CreateDealBody,
  type DealHistoryQuery,
  type DealQuery,
  type TransitionDealBody,
  type UpdateDealBody,
} from "./deal.schemas.js";
import {
  toPublicDeal,
  toPublicDealTransition,
  type PublicDeal,
  type PublicDealPage,
  type PublicDealTransition,
} from "./deal.types.js";

// ---------------------------------------------------------------------------
// Money policy (Phase 4)
//
// Deals move money as strings — validated ISO 4217 code + minor-unit precision
// at the boundary, and DECIMAL(28,8) columns in the DB. No JS float ever
// represents, computes, or serializes a monetary amount: a "1234.56" string is
// handed to Prisma as a Decimal and leaves as a string. See deal.schemas.ts
// for the precision rules.
// ---------------------------------------------------------------------------

type DbTransaction = Prisma.TransactionClient;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Canonical, key-sorted JSON fingerprint of a request body for idempotency. */
function canonicalJson(value: unknown): string {
  const sort = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === "object") {
      const record = input as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(record).sort())
        out[key] = sort(record[key]);
      return out;
    }
    return input;
  };
  return JSON.stringify(sort(value));
}

function isUniqueViolationOn(err: unknown, fieldParts: string[]): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== "P2002") return false;
  const target = Array.isArray(err.meta?.target)
    ? (err.meta?.target as string[])
    : [];
  return target.some((t) => fieldParts.some((part) => t.includes(part)));
}

// ---------------------------------------------------------------------------
// Deal references
// ---------------------------------------------------------------------------

export const REFERENCE_PREFIX = "AEG";

/**
 * Collision-safe reference generation: `AEG-<utcYear>-<zero-padded seq>`.
 * The sequence is derived (per organization) inside the creation transaction,
 * so two concurrent creates in the same organization get distinct numbers —
 * and if they ever race, the `@@unique([organizationId, reference])` database
 * constraint forces a bounded retry instead of a silent duplicate. Never
 * based on a timestamp alone.
 */
async function nextReference(
  tx: DbTransaction,
  organizationId: string,
  now: Date,
  attempt: number,
): Promise<string> {
  const year = now.getUTCFullYear();
  const prefix = `${REFERENCE_PREFIX}-${year}-`;
  const count = await tx.deal.count({
    where: { organizationId, reference: { startsWith: prefix } },
  });
  return `${prefix}${String(count + attempt + 1).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Deal CRUD
// ---------------------------------------------------------------------------

/**
 * Creates a deal in DRAFT within `organizationId`. Permission to create is
 * enforced by the route; every query here is organization-scoped.
 *
 * Idempotency: when `body.idempotencyKey` is supplied, the deal stores hashes
 * of the key and of the authorized body. A retried request with the same key
 * returns the original deal; the same key with a materially different body is
 * rejected with 409. The `@@unique([organizationId, idempotencyKeyHash])`
 * constraint makes even concurrent identical creates collapse to one deal.
 */
export async function createDeal(
  organizationId: string,
  body: CreateDealBody,
  actorUserId: string,
  meta: RequestMeta,
): Promise<PublicDeal> {
  const keyHash = body.idempotencyKey ? sha256(body.idempotencyKey) : undefined;
  const payloadHash = body.idempotencyKey
    ? sha256(canonicalJson(body))
    : undefined;

  if (keyHash) {
    const replay = await prisma.deal.findFirst({
      where: { organizationId, idempotencyKeyHash: keyHash },
    });
    if (replay) return assertIdempotentReplay(replay, payloadHash);
  }

  const MAX_ATTEMPTS = 8;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const deal = await createDealTx(
        organizationId,
        body,
        actorUserId,
        meta,
        keyHash,
        payloadHash,
        attempt,
      );
      return toPublicDeal(deal);
    } catch (err) {
      // Server-generated reference raced — retry with the next candidate.
      if (
        body.reference === undefined &&
        isUniqueViolationOn(err, ["reference"])
      ) {
        continue;
      }
      if (keyHash && isUniqueViolationOn(err, ["idempotencyKeyHash"])) {
        const replay = await prisma.deal.findFirst({
          where: { organizationId, idempotencyKeyHash: keyHash },
        });
        if (replay) return assertIdempotentReplay(replay, payloadHash);
        throw AppError.idempotencyConflict(
          "Idempotency key conflict. Retry with a fresh key.",
        );
      }
      if (isUniqueViolationOn(err, ["reference"])) {
        throw AppError.conflict(
          "A deal with this reference already exists in the organization.",
        );
      }
      throw err;
    }
  }
  throw AppError.conflict(
    "Could not allocate a unique reference under concurrent load. Try a client-supplied reference.",
  );
}

function assertIdempotentReplay(
  deal: Deal,
  payloadHash: string | undefined,
): PublicDeal {
  if (!payloadHash || deal.idempotencyPayloadHash !== payloadHash) {
    throw AppError.idempotencyConflict(
      "This idempotency key was already used for a different request.",
    );
  }
  return toPublicDeal(deal);
}

async function createDealTx(
  organizationId: string,
  body: CreateDealBody,
  actorUserIdValue: string,
  meta: RequestMeta,
  keyHash: string | undefined,
  payloadHash: string | undefined,
  attempt: number,
) {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const reference =
      body.reference ?? (await nextReference(tx, organizationId, now, attempt));

    const created = await tx.deal.create({
      data: {
        organizationId,
        createdByUserId: actorUserIdValue,
        reference,
        type: body.type,
        status: "DRAFT",
        name: body.name,
        description: body.description ?? null,
        currency: body.currency,
        notionalAmount: body.notionalAmount,
        settlementDate: body.settlementDate ?? null,
        expiresAt: body.expiresAt ?? null,
        metadata: body.metadata ? (body.metadata as object) : undefined,
        idempotencyKeyHash: keyHash,
        idempotencyPayloadHash: payloadHash,
        version: 1,
      },
    });

    await tx.dealStateTransition.create({
      data: {
        dealId: created.id,
        organizationId,
        requestId: null,
        transitionType: "DEAL_CREATED",
        fromStatus: "DRAFT",
        toStatus: "DRAFT",
        reason: "Deal created.",
        actorUserId: actorUserIdValue,
      },
    });

    // The deal's owner organization joins automatically as the OWNER
    // participant — every deal has exactly one owner org, and that row exists
    // from the moment of creation so negotiation APIs can resolve it.
    const ownerParticipant = await tx.dealParticipant.create({
      data: {
        dealId: created.id,
        organizationId,
        participantType: "OWNER",
        status: "ACTIVE",
        invitedByUserId: null,
        joinedAt: now,
        version: 1,
      },
    });
    await tx.dealParticipantTransition.create({
      data: {
        dealParticipantId: ownerParticipant.id,
        dealId: created.id,
        organizationId,
        requestId: null,
        transitionType: "PARTICIPANT_JOINED",
        fromStatus: "ACTIVE",
        toStatus: "ACTIVE",
        reason: "Deal owner organization auto-joined.",
        actorUserId: actorUserIdValue,
      },
    });

    await writeSecurityEvent(tx, {
      type: SecurityEventType.DEAL_CREATED,
      userId: actorUserIdValue,
      organizationId,
      metadata: { dealId: created.id, reference },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return created;
  });
}

/**
 * Bounded, deterministic listing within `organizationId`. Offset pagination
 * (replaceable by cursor later) with a hard server-side page-size cap, status/
 * type filters, case-insensitive reference/name search, and a createdAt range.
 * Ordering is always `[sort, order]` then `id` so a page is stable.
 */
export async function listDeals(
  organizationId: string,
  query: DealQuery,
): Promise<PublicDealPage> {
  const { page, limit } = query;
  const where: Prisma.DealWhereInput = { organizationId };

  if (query.status) where.status = query.status;
  if (query.type) where.type = query.type;
  if (query.createdFrom || query.createdTo) {
    where.createdAt = {
      ...(query.createdFrom ? { gte: query.createdFrom } : {}),
      ...(query.createdTo ? { lte: query.createdTo } : {}),
    };
  }
  if (query.search) {
    const like = escapeLike(query.search);
    where.OR = [
      { reference: { contains: like, mode: "insensitive" } },
      { name: { contains: like, mode: "insensitive" } },
    ];
  }

  const dir = query.order;
  const sortKey = query.sort;
  const orderBy: Prisma.DealOrderByWithRelationInput[] =
    sortKey === "createdAt"
      ? [{ createdAt: dir }, { id: dir }]
      : [{ [sortKey]: dir }, { createdAt: dir }, { id: dir }];

  const [deals, total] = await prisma.$transaction([
    prisma.deal.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.deal.count({ where }),
  ]);

  return {
    deals: deals.map(toPublicDeal),
    total,
    page,
    limit,
  };
}

/** Escapes LIKE wildcards so user search input can never widen a pattern. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/** Organization-scoped single deal. */
export async function getDeal(
  organizationId: string,
  dealId: string,
): Promise<PublicDeal> {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, organizationId },
  });
  if (!deal) throw AppError.dealNotFound();
  return toPublicDeal(deal);
}

/**
 * Immutable, chronological transition trail for a deal. Requests only the
 * deal's own rows after proving the deal exists in the caller's org scope.
 */
export async function getDealHistory(
  organizationId: string,
  dealId: string,
  query: DealHistoryQuery,
): Promise<{
  transitions: PublicDealTransition[];
  total: number;
  limit: number;
  offset: number;
}> {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, organizationId },
    select: { id: true },
  });
  if (!deal) throw AppError.dealNotFound();

  const [rows, total] = await prisma.$transaction([
    prisma.dealStateTransition.findMany({
      where: { dealId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: query.offset,
      take: query.limit,
    }),
    prisma.dealStateTransition.count({ where: { dealId } }),
  ]);

  return {
    transitions: rows.map(toPublicDealTransition),
    total,
    limit: query.limit,
    offset: query.offset,
  };
}

// ---------------------------------------------------------------------------
// Deal update
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES: readonly DealStatus[] = [
  "COMPLETED",
  "EXPIRED",
  "CANCELLED",
  "FAILED",
  "DISPUTED",
];

/** Financial terms are frozen once the deal leaves pre-approval lifecycle. */
const TERM_EDITABLE_STATUSES: readonly DealStatus[] = [
  "DRAFT",
  "OPEN",
  "NEGOTIATING",
];

/**
 * Edits only presentation/term fields; status and ownership have dedicated
 * flows. Optimistic concurrency: the conditional `updateMany` writes only when
 * `version` still matches, so a concurrent edit or transition (both bump the
 * version) yields a deterministic 409 instead of a lost update.
 */
export async function updateDeal(
  organizationId: string,
  dealId: string,
  body: UpdateDealBody,
  actorUserIdValue: string,
  meta: RequestMeta,
): Promise<PublicDeal> {
  const current = await prisma.deal.findFirst({
    where: { id: dealId, organizationId },
  });
  if (!current) throw AppError.dealNotFound();

  if (TERMINAL_STATUSES.includes(current.status as DealStatus)) {
    throw AppError.invalidDealState(
      `Deals in ${current.status} are terminal and cannot be edited.`,
    );
  }

  const wantsTermEdit =
    body.type !== undefined ||
    body.currency !== undefined ||
    body.notionalAmount !== undefined ||
    body.settlementDate !== undefined;
  if (
    wantsTermEdit &&
    !TERM_EDITABLE_STATUSES.includes(current.status as DealStatus)
  ) {
    throw AppError.invalidDealState(
      `Financial terms can only be edited in DRAFT, OPEN or NEGOTIATING (current: ${current.status}).`,
    );
  }

  // When currency and/or notional changes, validate the resulting pair so a
  // currency swap cannot silently out-precision the stored amount.
  if (body.currency !== undefined || body.notionalAmount !== undefined) {
    const finalCurrency = body.currency ?? current.currency;
    const finalNotional =
      body.notionalAmount ?? current.notionalAmount.toString();
    assertMoneyForCurrency(finalNotional, finalCurrency);
  }

  const data: Prisma.DealUpdateManyMutationInput = {};
  const changed: string[] = [];
  if (body.name !== undefined && body.name !== current.name) {
    data.name = body.name;
    changed.push("name");
  }
  if (
    body.description !== undefined &&
    (body.description ?? null) !== current.description
  ) {
    data.description = body.description ?? null;
    changed.push("description");
  }
  if (body.type !== undefined && body.type !== current.type) {
    data.type = body.type;
    changed.push("type");
  }
  if (body.currency !== undefined && body.currency !== current.currency) {
    data.currency = body.currency;
    changed.push("currency");
  }
  if (
    body.notionalAmount !== undefined &&
    body.notionalAmount !== current.notionalAmount.toString()
  ) {
    data.notionalAmount = body.notionalAmount;
    changed.push("notionalAmount");
  }
  if (
    body.settlementDate !== undefined &&
    (body.settlementDate ?? null) !== current.settlementDate
  ) {
    data.settlementDate = body.settlementDate ?? null;
    changed.push("settlementDate");
  }
  if (
    body.expiresAt !== undefined &&
    (body.expiresAt ?? null) !== current.expiresAt
  ) {
    data.expiresAt = body.expiresAt ?? null;
    changed.push("expiresAt");
  }
  if (body.metadata !== undefined && body.metadata !== current.metadata) {
    data.metadata = body.metadata as object;
    changed.push("metadata");
  }

  if (changed.length === 0) {
    return toPublicDeal(current);
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const applied = await tx.deal.updateMany({
        where: { id: dealId, organizationId, version: body.version },
        data: { ...data, version: { increment: 1 } },
      });
      if (applied.count === 0) {
        const latest = await tx.deal.findFirst({
          where: { id: dealId, organizationId },
        });
        if (!latest) throw AppError.dealNotFound();
        throw AppError.dealVersionConflict();
      }
      const updated = await tx.deal.findFirst({
        where: { id: dealId, organizationId },
      });
      await writeSecurityEvent(tx, {
        type: SecurityEventType.DEAL_UPDATED,
        userId: actorUserIdValue,
        organizationId,
        metadata: { dealId, changed },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      return toPublicDeal(updated ?? current);
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (isUniqueViolationOn(err, ["reference"])) {
      throw AppError.conflict(
        "A deal with this reference already exists in the organization.",
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

export interface TransitionResult {
  deal: PublicDeal;
  transition: PublicDealTransition;
  /** True when this call replayed an already-applied request (idempotency). */
  replay: boolean;
}

/**
 * The single authorized path for any status change. The state machine in
 * deal-state.ts is the source of truth for legality; the version + status
 * conditional update is the concurrency guard; the appended transition row is
 * the immutable audit record; `requestId` is the idempotency key.
 *
 * Cancellation is just a transition to `CANCELLED` through this service.
 */
export async function transitionDeal(
  organizationId: string,
  dealId: string,
  body: TransitionDealBody,
  actorUserIdValue: string,
  meta: RequestMeta,
): Promise<TransitionResult> {
  const current = await prisma.deal.findFirst({
    where: { id: dealId, organizationId },
  });
  if (!current) throw AppError.dealNotFound();

  // Idempotent replay: a retried request must return the original result
  // EVEN IF the deal has since moved on — legality is evaluated against the
  // state at original application time, not the current state. Only a
  // mismatched target under the same requestId is rejected.
  const preExisting = await prisma.dealStateTransition.findFirst({
    where: { dealId, requestId: body.requestId },
    orderBy: { createdAt: "asc" },
  });
  if (preExisting) {
    assertReplayCompatible(preExisting, body.toStatus);
    return {
      deal: toPublicDeal(current),
      transition: toPublicDealTransition(preExisting),
      replay: true,
    };
  }

  if (!isLegalTransition(current.status as DealStatus, body.toStatus)) {
    throw AppError.invalidDealTransition(
      `Invalid deal transition: ${current.status} -> ${body.toStatus} is not permitted.`,
    );
  }

  const transitionType = transitionTypeFor(body.toStatus);
  const reason = body.reason ?? transitionReasonOf(transitionType);

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.dealStateTransition.findFirst({
        where: { dealId, requestId: body.requestId },
        orderBy: { createdAt: "asc" },
      });
      if (existing) {
        assertReplayCompatible(existing, body.toStatus);
        const latest = await tx.deal.findFirst({
          where: { id: dealId, organizationId },
        });
        return {
          deal: toPublicDeal(latest ?? current),
          transition: toPublicDealTransition(existing),
          replay: true,
        };
      }

      const applied = await tx.deal.updateMany({
        where: {
          id: dealId,
          organizationId,
          status: current.status,
          version: body.version,
        },
        data: { status: body.toStatus, version: { increment: 1 } },
      });
      if (applied.count === 0) {
        const raced = await tx.dealStateTransition.findFirst({
          where: { dealId, requestId: body.requestId },
          orderBy: { createdAt: "asc" },
        });
        if (raced) {
          assertReplayCompatible(raced, body.toStatus);
          const latest = await tx.deal.findFirst({
            where: { id: dealId, organizationId },
          });
          return {
            deal: toPublicDeal(latest ?? current),
            transition: toPublicDealTransition(raced),
            replay: true,
          };
        }
        const latest = await tx.deal.findFirst({
          where: { id: dealId, organizationId },
        });
        if (!latest) throw AppError.dealNotFound();
        throw AppError.dealVersionConflict();
      }

      const transition = await tx.dealStateTransition.create({
        data: {
          dealId,
          organizationId,
          requestId: body.requestId,
          transitionType,
          fromStatus: current.status,
          toStatus: body.toStatus,
          reason,
          actorUserId: actorUserIdValue,
        },
      });

      const latest = await tx.deal.findFirst({
        where: { id: dealId, organizationId },
      });

      await writeSecurityEvent(tx, {
        type: SecurityEventType.DEAL_STATE_CHANGED,
        userId: actorUserIdValue,
        organizationId,
        metadata: {
          dealId,
          fromStatus: current.status,
          toStatus: body.toStatus,
          reason,
          requestId: body.requestId,
        },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      if (body.toStatus === "CANCELLED") {
        await writeSecurityEvent(tx, {
          type: SecurityEventType.DEAL_CANCELLED,
          userId: actorUserIdValue,
          organizationId,
          metadata: {
            dealId,
            fromStatus: current.status,
            reason,
            requestId: body.requestId,
          },
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        });
      }

      return {
        deal: toPublicDeal(latest ?? current),
        transition: toPublicDealTransition(transition),
        replay: false,
      };
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (isUniqueViolationOn(err, ["requestId"])) {
      const raced = await prisma.dealStateTransition.findFirst({
        where: { dealId, requestId: body.requestId },
        orderBy: { createdAt: "asc" },
      });
      if (raced && raced.toStatus === body.toStatus) {
        const latest = await prisma.deal.findFirst({
          where: { id: dealId, organizationId },
        });
        return {
          deal: toPublicDeal(latest ?? current),
          transition: toPublicDealTransition(raced),
          replay: true,
        };
      }
      throw AppError.idempotencyConflict(
        "This transition requestId was already used for a different transition.",
      );
    }
    throw err;
  }
}

function assertReplayCompatible(
  existing: DealStateTransition,
  toStatus: string,
): void {
  if (existing.toStatus !== toStatus) {
    throw AppError.idempotencyConflict(
      "This transition requestId was already used for a different transition.",
    );
  }
}

// ---------------------------------------------------------------------------
// Background expiry worker
// ---------------------------------------------------------------------------

const DEADLINE_EXPIRABLE_STATUSES = [
  "DRAFT",
  "OPEN",
  "NEGOTIATING",
  "AGREED",
  "APPROVED",
] as const satisfies readonly string[];

/**
 * Idempotent, retry-safe deadline expiry. Finds deals whose expiresAt passed
 * AND whose status has a legal EXPIRED edge, then moves each through the state
 * machine (status + version conditional update, transition row, security
 * event, all in one transaction). A deal already moved by a concurrent worker
 * simply fails the conditional update and is skipped. Returns how many deals
 * were expired this pass.
 */
export async function expireEligibleDeals(
  now: Date = new Date(),
  batchSize = 100,
): Promise<number> {
  const candidates = await prisma.deal.findMany({
    where: {
      expiresAt: { lt: now },
      status: { in: [...DEADLINE_EXPIRABLE_STATUSES] as DealStatus[] },
    },
    select: {
      id: true,
      organizationId: true,
      status: true,
      version: true,
      expiresAt: true,
    },
    take: batchSize,
  });

  let expired = 0;
  for (const candidate of candidates) {
    if (!candidate.expiresAt || !isDeadlineExpirable(candidate.status)) {
      continue;
    }
    try {
      const applied = await prisma.$transaction(async (tx) => {
        const updated = await tx.deal.updateMany({
          where: {
            id: candidate.id,
            organizationId: candidate.organizationId,
            status: candidate.status,
            version: candidate.version,
          },
          data: { status: "EXPIRED", version: { increment: 1 } },
        });
        if (updated.count === 0) return false;

        const reason = `System expiry: deadline passed (${candidate.expiresAt?.toISOString()}).`;
        await tx.dealStateTransition.create({
          data: {
            dealId: candidate.id,
            organizationId: candidate.organizationId,
            requestId: null,
            transitionType: "DEAL_EXPIRED",
            fromStatus: candidate.status,
            toStatus: "EXPIRED",
            reason,
            actorUserId: null,
          },
        });
        await writeSecurityEvent(tx, {
          type: SecurityEventType.DEAL_EXPIRED,
          userId: undefined,
          organizationId: candidate.organizationId,
          metadata: {
            dealId: candidate.id,
            fromStatus: candidate.status,
            reason,
          },
          ipAddress: null,
          userAgent: null,
        });
        return true;
      });
      if (applied) expired += 1;
    } catch {
      // A competing worker or retry may have expired it already; the next run
      // is a full re-scan by design, so a transient failure is safe to skip.
      continue;
    }
  }
  return expired;
}
