import { createHash } from "node:crypto";
import type {
  DealRequirement,
  DealRequirementTransition,
  Prisma,
} from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors/index.js";
import {
  SecurityEventType,
  writeSecurityEvent,
} from "../auth/security-events.js";
import {
  requireRequirementLegalTransition,
  requirementReasonOf,
  requirementTransitionTypeFor,
  REQUIREMENT_EXPIRABLE_STATUSES,
  type RequirementStatus,
} from "./requirement-state.js";
import { canViewDocument } from "./document-policy.js";
import {
  assertDealOperational,
  currentChainVersion,
} from "./document.service.js";
import {
  toPublicRequirement,
  toPublicRequirementTransition,
  type PublicReadiness,
  type PublicRequirement,
  type PublicRequirementTransition,
  type ReadinessRequirement,
} from "./document.types.js";
import type {
  AttachRequirementDocumentBody,
  CreateRequirementBody,
  RejectRequirementBody,
  ReopenRequirementBody,
  RequirementQuery,
  SatisfyRequirementBody,
  SubmitRequirementBody,
  WaiveRequirementBody,
} from "./requirement.schemas.js";
import type { DealViewer } from "../negotiation/participant-policy.js";
import type { RequestMeta } from "../organizations/organization.service.js";

type RequirementRow = DealRequirement & {
  documents?: Array<{ documentGroupId: string }>;
};

const REQUIREMENT_INCLUDE = {
  documents: { select: { documentGroupId: true } },
} satisfies Prisma.DealRequirementInclude;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalRequirementMeta(meta: {
  requirementType: string;
  title: string;
  description: string | null;
  assignedOrganizationId: string | null;
  required: boolean;
  dueAt: Date | null;
}): string {
  return JSON.stringify({
    requirementType: meta.requirementType,
    title: meta.title,
    description: meta.description,
    assignedOrganizationId: meta.assignedOrganizationId,
    required: meta.required,
    dueAt: meta.dueAt?.toISOString() ?? null,
  });
}

/** A requirement is visible to the owner org and the assigned org only. */
async function fetchRequirementForViewer(
  dealId: string,
  requirementId: string,
  viewer: DealViewer,
): Promise<RequirementRow> {
  const requirement = await prisma.dealRequirement.findFirst({
    where: { id: requirementId, dealId },
    include: REQUIREMENT_INCLUDE,
  });
  if (!requirement) throw AppError.requirementNotFound();
  const visible =
    viewer.isOwner ||
    requirement.assignedOrganizationId === viewer.organizationId;
  if (!visible) throw AppError.requirementNotFound();
  return requirement;
}

/** Applies one requirement transition behind a conditional status update. */
async function applyRequirementTransition(
  tx: Prisma.TransactionClient,
  requirement: {
    id: string;
    dealId: string;
    organizationId: string;
    status: RequirementStatus;
  },
  toStatus: RequirementStatus,
  requestId: string | null,
  reason: string,
  actorUserId: string | null,
  extra?: Prisma.DealRequirementUncheckedUpdateManyInput,
): Promise<{
  requirement: RequirementRow | null;
  transition: DealRequirementTransition | null;
}> {
  const applied = await tx.dealRequirement.updateMany({
    where: { id: requirement.id, status: requirement.status },
    data: { status: toStatus, ...(extra ?? {}) },
  });
  if (applied.count === 0) return { requirement: null, transition: null };
  const transition = await tx.dealRequirementTransition.create({
    data: {
      requirementId: requirement.id,
      dealId: requirement.dealId,
      organizationId: requirement.organizationId,
      requestId,
      transitionType: requirementTransitionTypeFor(toStatus),
      fromStatus: requirement.status,
      toStatus,
      reason,
      actorUserId,
    },
  });
  const updated = await tx.dealRequirement.findFirst({
    where: { id: requirement.id },
    include: REQUIREMENT_INCLUDE,
  });
  return { requirement: updated ?? null, transition };
}

/** Lazily marks a deadline-passed requirement EXPIRED. */
async function lazyRequirementExpire(
  tx: Prisma.TransactionClient,
  requirement: {
    id: string;
    dealId: string;
    organizationId: string;
    status: RequirementStatus;
  },
  actorUserId: string | null,
): Promise<void> {
  const applied = await tx.dealRequirement.updateMany({
    where: { id: requirement.id, status: requirement.status },
    data: { status: "EXPIRED" },
  });
  if (applied.count === 0) return;
  await tx.dealRequirementTransition.create({
    data: {
      requirementId: requirement.id,
      dealId: requirement.dealId,
      organizationId: requirement.organizationId,
      requestId: null,
      transitionType: "REQUIREMENT_EXPIRED",
      fromStatus: requirement.status,
      toStatus: "EXPIRED",
      reason: requirementReasonOf("REQUIREMENT_EXPIRED"),
      actorUserId,
    },
  });
  await writeSecurityEvent(tx, {
    type: SecurityEventType.REQUIREMENT_EXPIRED,
    userId: actorUserId ?? undefined,
    organizationId: requirement.organizationId,
    metadata: {
      requirementId: requirement.id,
      dealId: requirement.dealId,
      fromStatus: requirement.status,
    },
    ipAddress: null,
    userAgent: null,
  });
}

async function assertRequirementNotExpired(
  tx: Prisma.TransactionClient,
  requirement: {
    id: string;
    dealId: string;
    organizationId: string;
    status: RequirementStatus;
    dueAt: Date | null;
  },
  actorUserId: string | null,
): Promise<void> {
  if (requirement.dueAt && requirement.dueAt.getTime() <= Date.now()) {
    await lazyRequirementExpire(tx, requirement, actorUserId);
    throw AppError.requirementInvalidState(
      "This requirement's deadline has passed.",
    );
  }
}

export interface RequirementActionResult {
  requirement: PublicRequirement;
  transition: PublicRequirementTransition;
  replay: boolean;
}

async function renderReplay(
  requirement: RequirementRow,
  transition: DealRequirementTransition,
): Promise<RequirementActionResult> {
  return {
    requirement: toPublicRequirement(requirement),
    transition: toPublicRequirementTransition(transition),
    replay: true,
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/** Owner creates a requirement on the deal. */
export async function createRequirement(
  viewer: DealViewer,
  dealId: string,
  body: CreateRequirementBody,
  actorUserId: string,
  meta: RequestMeta,
): Promise<PublicRequirement> {
  if (!viewer.isOwner) {
    throw AppError.forbidden(
      "Only the deal owner organization can create requirements.",
    );
  }
  assertDealOperational(viewer.deal);

  if (body.assignedOrganizationId) {
    const target = await prisma.dealParticipant.findFirst({
      where: { dealId, organizationId: body.assignedOrganizationId },
    });
    if (!target) {
      throw AppError.requirementNotAssigned(
        "The assigned organization is not a participant of this deal.",
      );
    }
    if (target.status !== "ACTIVE") {
      throw AppError.requirementNotAssigned(
        "The assigned organization is not an ACTIVE participant of this deal.",
      );
    }
    if (target.participantType === "OBSERVER") {
      throw AppError.requirementNotAssigned(
        "OBSERVER participants cannot be assigned requirements.",
      );
    }
  }

  const payloadHash = sha256(
    canonicalRequirementMeta({
      requirementType: body.requirementType,
      title: body.title,
      description: body.description ?? null,
      assignedOrganizationId: body.assignedOrganizationId ?? null,
      required: body.required,
      dueAt: body.dueAt ?? null,
    }),
  );

  return prisma.$transaction(async (tx) => {
    if (body.idempotencyKey) {
      const keyHash = sha256(body.idempotencyKey);
      const existing = await tx.dealRequirement.findFirst({
        where: {
          dealId,
          organizationId: viewer.organizationId,
          idempotencyKeyHash: keyHash,
        },
        include: REQUIREMENT_INCLUDE,
        orderBy: { createdAt: "asc" },
      });
      if (existing) {
        if (
          existing.idempotencyPayloadHash &&
          existing.idempotencyPayloadHash !== payloadHash
        ) {
          throw AppError.idempotencyConflict(
            "idempotencyKey was reused with a different requirement.",
          );
        }
        return toPublicRequirement(existing);
      }
    }

    const requirement = await tx.dealRequirement.create({
      data: {
        dealId,
        organizationId: viewer.organizationId,
        createdByUserId: actorUserId,
        requirementType: body.requirementType,
        title: body.title,
        description: body.description ?? null,
        required: body.required,
        dueAt: body.dueAt ?? null,
        assignedOrganizationId: body.assignedOrganizationId ?? null,
        idempotencyKeyHash: body.idempotencyKey
          ? sha256(body.idempotencyKey)
          : null,
        idempotencyPayloadHash: payloadHash,
      },
      include: REQUIREMENT_INCLUDE,
    });

    await tx.dealRequirementTransition.create({
      data: {
        requirementId: requirement.id,
        dealId,
        organizationId: viewer.organizationId,
        requestId: null,
        transitionType: "REQUIREMENT_OPEN",
        fromStatus: "OPEN",
        toStatus: "OPEN",
        reason: requirementReasonOf("REQUIREMENT_OPEN"),
        actorUserId,
      },
    });

    await writeSecurityEvent(tx, {
      type: SecurityEventType.REQUIREMENT_CREATED,
      userId: actorUserId,
      organizationId: viewer.organizationId,
      metadata: {
        requirementId: requirement.id,
        dealId,
        requirementType: body.requirementType,
        assignedOrganizationId: body.assignedOrganizationId ?? null,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return toPublicRequirement(requirement);
  });
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

/** Assigned org (or the owner when unassigned) submits to the owner. */
export async function submitRequirement(
  viewer: DealViewer,
  dealId: string,
  requirementId: string,
  body: SubmitRequirementBody,
  actorUserId: string,
  meta: RequestMeta,
): Promise<RequirementActionResult> {
  const requirement = await fetchRequirementForViewer(
    dealId,
    requirementId,
    viewer,
  );

  const maySubmit =
    requirement.assignedOrganizationId === viewer.organizationId ||
    (requirement.assignedOrganizationId === null && viewer.isOwner);
  if (!maySubmit) {
    throw AppError.requirementNotAssigned(
      "This requirement is assigned to another organization.",
    );
  }

  const replay = await prisma.dealRequirementTransition.findFirst({
    where: {
      requirementId: requirement.id,
      requestId: body.requestId,
      toStatus: "SUBMITTED",
    },
    orderBy: { createdAt: "asc" },
  });
  if (replay) return renderReplay(requirement, replay);

  if (requirement.status === "SUBMITTED") {
    throw AppError.requirementInvalidState(
      "This requirement has already been submitted.",
    );
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const txReplay = await tx.dealRequirementTransition.findFirst({
      where: {
        requirementId: requirement.id,
        requestId: body.requestId,
        toStatus: "SUBMITTED",
      },
      orderBy: { createdAt: "asc" },
    });
    if (txReplay) return { kind: "replay" as const, transition: txReplay };

    requireRequirementLegalTransition(requirement.status, "SUBMITTED");
    await assertRequirementNotExpired(tx, requirement, actorUserId);

    const applied = await applyRequirementTransition(
      tx,
      requirement,
      "SUBMITTED",
      body.requestId ?? null,
      requirementReasonOf("REQUIREMENT_SUBMITTED"),
      actorUserId,
    );
    if (!applied.requirement) return { kind: "race" as const };

    await writeSecurityEvent(tx, {
      type: SecurityEventType.REQUIREMENT_SUBMITTED,
      userId: actorUserId,
      organizationId: viewer.organizationId,
      metadata: {
        requirementId: requirement.id,
        dealId,
        requestId: body.requestId,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      kind: "changed" as const,
      requirement: applied.requirement,
      transition: applied.transition,
    };
  });

  if (outcome.kind === "replay")
    return renderReplay(requirement, outcome.transition);
  if (outcome.kind === "race") throw AppError.documentVersionConflict();
  return {
    requirement: toPublicRequirement(outcome.requirement as RequirementRow),
    transition: toPublicRequirementTransition(
      outcome.transition as DealRequirementTransition,
    ),
    replay: false,
  };
}

// ---------------------------------------------------------------------------
// Owner verdicts: reject / waive / satisfy
// ---------------------------------------------------------------------------

/** Owner rejects a SUBMITTED requirement back to the assignee. */
export async function rejectRequirement(
  viewer: DealViewer,
  dealId: string,
  requirementId: string,
  body: RejectRequirementBody,
  actorUserId: string,
  meta: RequestMeta,
): Promise<RequirementActionResult> {
  if (!viewer.isOwner) {
    throw AppError.forbidden(
      "Only the deal owner organization can reject requirements.",
    );
  }
  const requirement = await fetchRequirementForViewer(
    dealId,
    requirementId,
    viewer,
  );

  const replay = await prisma.dealRequirementTransition.findFirst({
    where: {
      requirementId: requirement.id,
      requestId: body.requestId,
      toStatus: "REJECTED",
    },
    orderBy: { createdAt: "asc" },
  });
  if (replay) return renderReplay(requirement, replay);

  const outcome = await prisma.$transaction(async (tx) => {
    const txReplay = await tx.dealRequirementTransition.findFirst({
      where: {
        requirementId: requirement.id,
        requestId: body.requestId,
        toStatus: "REJECTED",
      },
      orderBy: { createdAt: "asc" },
    });
    if (txReplay) return { kind: "replay" as const, transition: txReplay };

    requireRequirementLegalTransition(requirement.status, "REJECTED");

    const applied = await applyRequirementTransition(
      tx,
      requirement,
      "REJECTED",
      body.requestId ?? null,
      `Rejected: ${body.reason}`,
      actorUserId,
      { rejectionReason: body.reason },
    );
    if (!applied.requirement) return { kind: "race" as const };

    await writeSecurityEvent(tx, {
      type: SecurityEventType.REQUIREMENT_REJECTED,
      userId: actorUserId,
      organizationId: viewer.organizationId,
      metadata: {
        requirementId: requirement.id,
        dealId,
        requestId: body.requestId,
        reason: body.reason,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      kind: "changed" as const,
      requirement: applied.requirement,
      transition: applied.transition,
    };
  });

  if (outcome.kind === "replay")
    return renderReplay(requirement, outcome.transition);
  if (outcome.kind === "race") throw AppError.documentVersionConflict();
  return {
    requirement: toPublicRequirement(outcome.requirement as RequirementRow),
    transition: toPublicRequirementTransition(
      outcome.transition as DealRequirementTransition,
    ),
    replay: false,
  };
}

/** Owner waives an OPEN requirement (removes it from blocking scope). */
export async function waiveRequirement(
  viewer: DealViewer,
  dealId: string,
  requirementId: string,
  body: WaiveRequirementBody,
  actorUserId: string,
  meta: RequestMeta,
): Promise<RequirementActionResult> {
  if (!viewer.isOwner) {
    throw AppError.forbidden(
      "Only the deal owner organization can waive requirements.",
    );
  }
  const requirement = await fetchRequirementForViewer(
    dealId,
    requirementId,
    viewer,
  );

  const replay = await prisma.dealRequirementTransition.findFirst({
    where: {
      requirementId: requirement.id,
      requestId: body.requestId,
      toStatus: "WAIVED",
    },
    orderBy: { createdAt: "asc" },
  });
  if (replay) return renderReplay(requirement, replay);

  const outcome = await prisma.$transaction(async (tx) => {
    const txReplay = await tx.dealRequirementTransition.findFirst({
      where: {
        requirementId: requirement.id,
        requestId: body.requestId,
        toStatus: "WAIVED",
      },
      orderBy: { createdAt: "asc" },
    });
    if (txReplay) return { kind: "replay" as const, transition: txReplay };

    requireRequirementLegalTransition(requirement.status, "WAIVED");
    const now = new Date();

    const applied = await applyRequirementTransition(
      tx,
      requirement,
      "WAIVED",
      body.requestId ?? null,
      body.reason
        ? `Waived: ${body.reason}`
        : requirementReasonOf("REQUIREMENT_WAIVED"),
      actorUserId,
      { waivedAt: now, waivedByUserId: actorUserId },
    );
    if (!applied.requirement) return { kind: "race" as const };

    await writeSecurityEvent(tx, {
      type: SecurityEventType.REQUIREMENT_WAIVED,
      userId: actorUserId,
      organizationId: viewer.organizationId,
      metadata: {
        requirementId: requirement.id,
        dealId,
        requestId: body.requestId,
        reason: body.reason ?? null,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      kind: "changed" as const,
      requirement: applied.requirement,
      transition: applied.transition,
    };
  });

  if (outcome.kind === "replay")
    return renderReplay(requirement, outcome.transition);
  if (outcome.kind === "race") throw AppError.documentVersionConflict();
  return {
    requirement: toPublicRequirement(outcome.requirement as RequirementRow),
    transition: toPublicRequirementTransition(
      outcome.transition as DealRequirementTransition,
    ),
    replay: false,
  };
}

/** Owner reopens a REJECTED requirement so the assignee can resubmit. */
export async function reopenRequirement(
  viewer: DealViewer,
  dealId: string,
  requirementId: string,
  body: ReopenRequirementBody,
  actorUserId: string,
  meta: RequestMeta,
): Promise<RequirementActionResult> {
  if (!viewer.isOwner) {
    throw AppError.forbidden(
      "Only the deal owner organization can reopen requirements.",
    );
  }
  const requirement = await fetchRequirementForViewer(
    dealId,
    requirementId,
    viewer,
  );

  const replay = await prisma.dealRequirementTransition.findFirst({
    where: {
      requirementId: requirement.id,
      requestId: body.requestId,
      toStatus: "OPEN",
    },
    orderBy: { createdAt: "asc" },
  });
  if (replay) return renderReplay(requirement, replay);

  const outcome = await prisma.$transaction(async (tx) => {
    const txReplay = await tx.dealRequirementTransition.findFirst({
      where: {
        requirementId: requirement.id,
        requestId: body.requestId,
        toStatus: "OPEN",
      },
      orderBy: { createdAt: "asc" },
    });
    if (txReplay) return { kind: "replay" as const, transition: txReplay };

    requireRequirementLegalTransition(requirement.status, "OPEN");

    const applied = await applyRequirementTransition(
      tx,
      requirement,
      "OPEN",
      body.requestId ?? null,
      requirementReasonOf("REQUIREMENT_OPEN"),
      actorUserId,
    );
    if (!applied.requirement) return { kind: "race" as const };

    await writeSecurityEvent(tx, {
      type: SecurityEventType.REQUIREMENT_REOPENED,
      userId: actorUserId,
      organizationId: viewer.organizationId,
      metadata: {
        requirementId: requirement.id,
        dealId,
        requestId: body.requestId,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      kind: "changed" as const,
      requirement: applied.requirement,
      transition: applied.transition,
    };
  });

  if (outcome.kind === "replay")
    return renderReplay(requirement, outcome.transition);
  if (outcome.kind === "race") throw AppError.documentVersionConflict();
  return {
    requirement: toPublicRequirement(outcome.requirement as RequirementRow),
    transition: toPublicRequirementTransition(
      outcome.transition as DealRequirementTransition,
    ),
    replay: false,
  };
}

/**
 * Owner marks a SUBMITTED requirement satisfied. DOCUMENT-type requirements
 * must reference a document whose current materialized version is ACCEPTED
 * (and not expired) — the exact guarantee readiness re-checks.
 */
export async function satisfyRequirement(
  viewer: DealViewer,
  dealId: string,
  requirementId: string,
  body: SatisfyRequirementBody,
  actorUserId: string,
  meta: RequestMeta,
): Promise<RequirementActionResult> {
  if (!viewer.isOwner) {
    throw AppError.forbidden(
      "Only the deal owner organization can satisfy requirements.",
    );
  }
  const requirement = await fetchRequirementForViewer(
    dealId,
    requirementId,
    viewer,
  );

  const replay = await prisma.dealRequirementTransition.findFirst({
    where: {
      requirementId: requirement.id,
      requestId: body.requestId,
      toStatus: "SATISFIED",
    },
    orderBy: { createdAt: "asc" },
  });
  if (replay) return renderReplay(requirement, replay);

  const outcome = await prisma.$transaction(async (tx) => {
    const txReplay = await tx.dealRequirementTransition.findFirst({
      where: {
        requirementId: requirement.id,
        requestId: body.requestId,
        toStatus: "SATISFIED",
      },
      orderBy: { createdAt: "asc" },
    });
    if (txReplay) return { kind: "replay" as const, transition: txReplay };

    requireRequirementLegalTransition(requirement.status, "SATISFIED");

    if (requirement.requirementType === "DOCUMENT") {
      const attached = requirement.documents ?? [];
      let approved = false;
      for (const doc of attached) {
        const current = await currentChainVersion(doc.documentGroupId, tx);
        if (
          current &&
          current.status === "ACCEPTED" &&
          (!current.expiresAt || current.expiresAt.getTime() > Date.now())
        ) {
          approved = true;
          break;
        }
      }
      if (!approved) {
        throw AppError.requirementDocumentInvalid(
          "A DOCUMENT requirement must reference a currently ACCEPTED document before it can be satisfied.",
        );
      }
    }

    const now = new Date();
    const applied = await applyRequirementTransition(
      tx,
      requirement,
      "SATISFIED",
      body.requestId ?? null,
      body.comment
        ? `Satisfied: ${body.comment}`
        : requirementReasonOf("REQUIREMENT_SATISFIED"),
      actorUserId,
      { satisfiedAt: now, satisfiedByUserId: actorUserId },
    );
    if (!applied.requirement) return { kind: "race" as const };

    await writeSecurityEvent(tx, {
      type: SecurityEventType.REQUIREMENT_SATISFIED,
      userId: actorUserId,
      organizationId: viewer.organizationId,
      metadata: {
        requirementId: requirement.id,
        dealId,
        requestId: body.requestId,
        comment: body.comment ?? null,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      kind: "changed" as const,
      requirement: applied.requirement,
      transition: applied.transition,
    };
  });

  if (outcome.kind === "replay")
    return renderReplay(requirement, outcome.transition);
  if (outcome.kind === "race") throw AppError.documentVersionConflict();
  return {
    requirement: toPublicRequirement(outcome.requirement as RequirementRow),
    transition: toPublicRequirementTransition(
      outcome.transition as DealRequirementTransition,
    ),
    replay: false,
  };
}

// ---------------------------------------------------------------------------
// Attach a document to a requirement
// ---------------------------------------------------------------------------

/** Assignee or owner links a visible document to an open requirement. */
export async function attachRequirementDocument(
  viewer: DealViewer,
  dealId: string,
  requirementId: string,
  body: AttachRequirementDocumentBody,
  actorUserId: string,
  meta: RequestMeta,
): Promise<PublicRequirement> {
  const requirement = await fetchRequirementForViewer(
    dealId,
    requirementId,
    viewer,
  );

  const mayAttach =
    viewer.isOwner ||
    requirement.assignedOrganizationId === viewer.organizationId;
  if (!mayAttach) {
    throw AppError.requirementNotAssigned(
      "This requirement is assigned to another organization.",
    );
  }
  if (requirement.status !== "OPEN" && requirement.status !== "SUBMITTED") {
    throw AppError.requirementInvalidState(
      `Documents can only be attached while the requirement is OPEN or SUBMITTED (current status: ${requirement.status}).`,
    );
  }

  const document = await prisma.dealDocument.findFirst({
    where: { id: body.documentId, dealId },
    include: { visibilityParticipants: true },
  });
  if (
    !document ||
    !canViewDocument(document, viewer.organizationId, viewer.isOwner)
  ) {
    throw AppError.documentNotFound();
  }
  if (document.status === "UPLOADING" || !document.storageKey) {
    throw AppError.documentNotReady(
      "The referenced document is not fully uploaded yet.",
    );
  }

  return prisma.$transaction(async (tx) => {
    // Idempotency: check first so a duplicate attach never poisons the
    // transaction (a caught P2002 aborts the whole Postgres tx).
    const paired = await tx.requirementDocument.findFirst({
      where: {
        requirementId: requirement.id,
        documentGroupId: document.chainId,
      },
    });
    if (!paired) {
      await tx.requirementDocument.create({
        data: {
          requirementId: requirement.id,
          documentGroupId: document.chainId,
          documentId: document.id,
          organizationId: viewer.organizationId,
          attachedByUserId: actorUserId,
        },
      });

      await writeSecurityEvent(tx, {
        type: SecurityEventType.REQUIREMENT_DOCUMENT_ATTACHED,
        userId: actorUserId,
        organizationId: viewer.organizationId,
        metadata: {
          requirementId: requirement.id,
          dealId,
          documentId: document.id,
          documentGroupId: document.chainId,
        },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
    }

    const fresh = await tx.dealRequirement.findFirst({
      where: { id: requirement.id },
      include: REQUIREMENT_INCLUDE,
    });
    if (!fresh) throw AppError.requirementNotFound();
    return toPublicRequirement(fresh);
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getRequirement(
  viewer: DealViewer,
  dealId: string,
  requirementId: string,
): Promise<PublicRequirement> {
  const requirement = await fetchRequirementForViewer(
    dealId,
    requirementId,
    viewer,
  );
  return toPublicRequirement(requirement);
}

/** Requirements visible to the viewer (owner: all; others: their own). */
export async function listRequirements(
  viewer: DealViewer,
  dealId: string,
  query: RequirementQuery,
): Promise<{
  requirements: PublicRequirement[];
  total: number;
  page: number;
  limit: number;
}> {
  const where: Prisma.DealRequirementWhereInput = {
    dealId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.required !== undefined ? { required: query.required } : {}),
    ...(query.assignedOrganizationId
      ? { assignedOrganizationId: query.assignedOrganizationId }
      : {}),
    ...(viewer.isOwner
      ? {}
      : { assignedOrganizationId: viewer.organizationId }),
  };
  const skip = (query.page - 1) * query.limit;
  const [rows, total] = await prisma.$transaction([
    prisma.dealRequirement.findMany({
      where,
      include: REQUIREMENT_INCLUDE,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take: query.limit,
    }),
    prisma.dealRequirement.count({ where }),
  ]);
  return {
    requirements: rows.map((row) => toPublicRequirement(row)),
    total,
    page: query.page,
    limit: query.limit,
  };
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

/**
 * Current readiness snapshot (owner-only). Required requirements that are
 * WAIVED or EXPIRED leave scope; everything else must be satisfied — a
 * DOCUMENT requirement is only satisfied while the referenced chain's current
 * version is ACCEPTED and unexpired (an expired acceptance re-blocks).
 */
export async function getRequirementReadiness(
  viewer: DealViewer,
  dealId: string,
): Promise<PublicReadiness> {
  if (!viewer.isOwner) {
    throw AppError.forbidden(
      "Only the deal owner organization can view deal readiness.",
    );
  }
  const now = Date.now();
  const rows = await prisma.dealRequirement.findMany({
    where: {
      dealId,
      required: true,
      status: { notIn: ["WAIVED", "EXPIRED"] },
    },
    include: REQUIREMENT_INCLUDE,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const requirements: ReadinessRequirement[] = [];
  let satisfiedCount = 0;
  for (const row of rows) {
    let satisfied = row.status === "SATISFIED";
    if (satisfied && row.requirementType === "DOCUMENT") {
      let approved = false;
      for (const doc of row.documents ?? []) {
        const current = await currentChainVersion(doc.documentGroupId);
        if (
          current &&
          current.status === "ACCEPTED" &&
          (!current.expiresAt || current.expiresAt.getTime() > now)
        ) {
          approved = true;
          break;
        }
      }
      satisfied = approved;
    }
    if (satisfied) satisfiedCount += 1;
    requirements.push({
      id: row.id,
      title: row.title,
      requirementType: row.requirementType,
      required: true,
      status: row.status,
      satisfied,
    });
  }

  const outstanding = requirements.length - satisfiedCount;
  return {
    dealId,
    required: requirements.length,
    satisfied: satisfiedCount,
    outstanding,
    blocked: outstanding > 0,
    requirements,
  };
}

// ---------------------------------------------------------------------------
// Expiry worker
// ---------------------------------------------------------------------------

/**
 * System worker: expires OPEN/SUBMITTED requirements whose `dueAt` passed.
 * Safe to run concurrently and to re-run.
 */
export async function expireEligibleRequirements(
  now: Date = new Date(),
  batchSize = 100,
): Promise<number> {
  const candidates = await prisma.dealRequirement.findMany({
    where: {
      dueAt: { lt: now },
      status: { in: [...REQUIREMENT_EXPIRABLE_STATUSES] },
    },
    select: {
      id: true,
      dealId: true,
      organizationId: true,
      status: true,
      dueAt: true,
      assignedOrganizationId: true,
      required: true,
    },
    take: batchSize,
  });

  let expired = 0;
  for (const candidate of candidates) {
    try {
      const changed = await prisma.$transaction(async (tx) => {
        const applied = await tx.dealRequirement.updateMany({
          where: { id: candidate.id, status: candidate.status },
          data: { status: "EXPIRED" },
        });
        if (applied.count === 0) return false;
        await tx.dealRequirementTransition.create({
          data: {
            requirementId: candidate.id,
            dealId: candidate.dealId,
            organizationId: candidate.organizationId,
            requestId: `system:expire:req:${candidate.id}`,
            transitionType: "REQUIREMENT_EXPIRED",
            fromStatus: candidate.status,
            toStatus: "EXPIRED",
            reason:
              `System expiry: requirement deadline passed ` +
              `(${candidate.dueAt?.toISOString() ?? "unknown"}).`,
            actorUserId: null,
          },
        });
        await writeSecurityEvent(tx, {
          type: SecurityEventType.REQUIREMENT_EXPIRED,
          userId: undefined,
          organizationId: candidate.organizationId,
          metadata: {
            requirementId: candidate.id,
            dealId: candidate.dealId,
            fromStatus: candidate.status,
            required: candidate.required,
            assignedOrganizationId: candidate.assignedOrganizationId,
            reason: "Requirement deadline passed.",
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
