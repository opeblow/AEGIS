import { createHash } from "node:crypto";
import type { OrganizationCounterparty, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors/index.js";
import {
  SecurityEventType,
  writeSecurityEvent,
} from "../auth/security-events.js";
import type { RequestMeta } from "../organizations/organization.service.js";
import type { OrgAccess } from "../organizations/authorization.service.js";
import type {
  CounterpartyCreateBody,
  CounterpartyQuery,
  CounterpartyUpdateBody,
} from "./negotiation.schemas.js";
import {
  toPublicCounterparty,
  type PublicCounterparty,
  type PublicCounterpartyPage,
} from "./negotiation.types.js";

type CounterpartyRow = OrganizationCounterparty & {
  counterpartyOrganization?: {
    id: string;
    name: string;
    legalName: string | null;
    country: string | null;
  };
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Canonical pair key: SHA-256 of the two sorted organization ids. */
export function counterpartyPairKey(a: string, b: string): string {
  return sha256([a, b].sort().join("|"));
}

/**
 * Lifecycle transitions for the counterparty relationship status. REVOKED is
 * terminal. Mirrors the audit discipline everywhere else: the move is applied
 * and audited atomically, never edited in place.
 */
const COUNTERPARTY_STATUS_TRANSITIONS: Readonly<
  Record<string, ReadonlySet<string>>
> = {
  PENDING: new Set(["ACTIVE", "REVOKED"]),
  ACTIVE: new Set(["SUSPENDED", "REVOKED"]),
  SUSPENDED: new Set(["ACTIVE", "REVOKED"]),
  REVOKED: new Set(),
};

const COUNTERPARTY_VERIFICATION_TRANSITIONS: Readonly<
  Record<string, ReadonlySet<string>>
> = {
  UNVERIFIED: new Set(["PENDING", "VERIFIED"]),
  PENDING: new Set(["VERIFIED", "REJECTED"]),
  VERIFIED: new Set(),
  REJECTED: new Set(),
};

export function assertCounterpartyStatusTransition(
  from: string,
  to: string,
): void {
  const allowed = COUNTERPARTY_STATUS_TRANSITIONS[from];
  if (!allowed || !allowed.has(to)) {
    throw AppError.counterpartyInvalidTransition(
      `Invalid counterparty status transition: ${from} -> ${to}.`,
    );
  }
}

export function assertCounterpartyVerificationTransition(
  from: string,
  to: string,
): void {
  const allowed = COUNTERPARTY_VERIFICATION_TRANSITIONS[from];
  if (!allowed || !allowed.has(to)) {
    throw AppError.counterpartyInvalidTransition(
      `Invalid counterparty verification transition: ${from} -> ${to}.`,
    );
  }
}

/**
 * Creates (or surfaces) a normalized, bidirectional counterparty relationship
 * between `organizationId` and the target. The relationship is a shared,
 * single row: status PENDING by default; both orgs see the same record.
 */
export async function createCounterparty(
  _access: OrgAccess,
  organizationId: string,
  body: CounterpartyCreateBody,
  actorUserId: string,
  meta: RequestMeta,
): Promise<PublicCounterparty> {
  const targetId = body.counterpartyOrganizationId;
  if (targetId === organizationId) throw AppError.counterpartySelf();

  const target = await prisma.organization.findFirst({
    where: { id: targetId, status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      legalName: true,
      country: true,
      status: true,
    },
  });
  // Unknown/archived orgs collapse to the same generic 404.
  if (!target || target.status !== "ACTIVE") {
    throw AppError.counterpartyNotFound("Organization not found.");
  }

  const pairKey = counterpartyPairKey(organizationId, targetId);
  const existing = await prisma.organizationCounterparty.findUnique({
    where: { pairKey },
  });
  if (existing) throw AppError.counterpartyExists();

  const created = await prisma.organizationCounterparty.create({
    data: {
      organizationId,
      counterpartyOrganizationId: targetId,
      pairKey,
      status: "PENDING",
      verificationStatus: "UNVERIFIED",
      createdByUserId: actorUserId,
    },
    include: { organization: true, counterpartyOrganization: true },
  });

  await writeSecurityEvent(prisma, {
    type: SecurityEventType.COUNTERPARTY_CREATED,
    userId: actorUserId,
    organizationId,
    metadata: {
      counterpartyId: created.id,
      counterpartyOrganizationId: targetId,
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return toPublicCounterparty(created, organizationId);
}

/** Lists relationships in either direction with optional filters. */
export async function listCounterparties(
  organizationId: string,
  query: CounterpartyQuery,
): Promise<PublicCounterpartyPage> {
  const { page, limit } = query;
  const where: Prisma.OrganizationCounterpartyWhereInput = {
    OR: [{ organizationId }, { counterpartyOrganizationId: organizationId }],
  };
  if (query.status) where.status = query.status;
  if (query.verificationStatus) {
    where.verificationStatus = query.verificationStatus;
  }
  if (query.direction === "outgoing") {
    where.OR = [{ organizationId }];
  } else if (query.direction === "incoming") {
    where.OR = [{ counterpartyOrganizationId: organizationId }];
  }
  if (query.search) {
    where.counterpartyOrganization = {
      OR: [
        { name: { contains: query.search, mode: "insensitive" } },
        { legalName: { contains: query.search, mode: "insensitive" } },
      ],
    };
  }

  const [rows, total] = await prisma.$transaction([
    prisma.organizationCounterparty.findMany({
      where,
      include: { organization: true, counterpartyOrganization: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.organizationCounterparty.count({ where }),
  ]);

  return {
    counterparties: rows.map((row) =>
      toPublicCounterparty(row, organizationId),
    ),
    total,
    page,
    limit,
  };
}

/** Single relationship visible in either direction. */
export async function getCounterparty(
  organizationId: string,
  counterpartyId: string,
): Promise<PublicCounterparty> {
  const row = await prisma.organizationCounterparty.findFirst({
    where: {
      id: counterpartyId,
      OR: [{ organizationId }, { counterpartyOrganizationId: organizationId }],
    },
    include: { organization: true, counterpartyOrganization: true },
  });
  if (!row) throw AppError.counterpartyNotFound();
  return toPublicCounterparty(row, organizationId);
}

/** Applies status/verification moves atomically with the audit event. */
export async function updateCounterparty(
  organizationId: string,
  counterpartyId: string,
  body: CounterpartyUpdateBody,
  actorUserId: string,
  meta: RequestMeta,
): Promise<PublicCounterparty> {
  const row = await prisma.organizationCounterparty.findFirst({
    where: {
      id: counterpartyId,
      OR: [{ organizationId }, { counterpartyOrganizationId: organizationId }],
    },
    include: { organization: true, counterpartyOrganization: true },
  });
  if (!row) throw AppError.counterpartyNotFound();

  if (body.status !== undefined) {
    assertCounterpartyStatusTransition(row.status, body.status);
  }
  if (body.verificationStatus !== undefined) {
    assertCounterpartyVerificationTransition(
      row.verificationStatus,
      body.verificationStatus,
    );
  }

  const updated = await prisma.organizationCounterparty.update({
    where: { id: row.id },
    data: {
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.verificationStatus !== undefined
        ? { verificationStatus: body.verificationStatus }
        : {}),
    },
    include: { organization: true, counterpartyOrganization: true },
  });

  if (body.status !== undefined) {
    await writeSecurityEvent(prisma, {
      type: SecurityEventType.COUNTERPARTY_UPDATED,
      userId: actorUserId,
      organizationId,
      metadata: {
        counterpartyId,
        fromStatus: row.status,
        toStatus: body.status,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }
  if (body.verificationStatus !== undefined) {
    await writeSecurityEvent(prisma, {
      type: SecurityEventType.COUNTERPARTY_VERIFICATION_CHANGED,
      userId: actorUserId,
      organizationId,
      metadata: {
        counterpartyId,
        fromVerification: row.verificationStatus,
        toVerification: body.verificationStatus,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }

  return toPublicCounterparty(updated, organizationId);
}

/** Soft-revokes a relationship (REVOKED is terminal). */
export async function revokeCounterparty(
  organizationId: string,
  counterpartyId: string,
  actorUserId: string,
  meta: RequestMeta,
): Promise<PublicCounterparty> {
  const row = await prisma.organizationCounterparty.findFirst({
    where: {
      id: counterpartyId,
      OR: [{ organizationId }, { counterpartyOrganizationId: organizationId }],
    },
    include: { organization: true, counterpartyOrganization: true },
  });
  if (!row) throw AppError.counterpartyNotFound();
  if (row.status === "REVOKED")
    return toPublicCounterparty(row, organizationId);

  assertCounterpartyStatusTransition(row.status, "REVOKED");
  const updated = await prisma.organizationCounterparty.update({
    where: { id: row.id },
    data: { status: "REVOKED" },
    include: { organization: true, counterpartyOrganization: true },
  });

  await writeSecurityEvent(prisma, {
    type: SecurityEventType.COUNTERPARTY_REVOKED,
    userId: actorUserId,
    organizationId,
    metadata: { counterpartyId, fromStatus: row.status },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return toPublicCounterparty(updated, organizationId);
}

export type { CounterpartyRow };
