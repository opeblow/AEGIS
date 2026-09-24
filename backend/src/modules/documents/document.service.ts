import { createHash, randomUUID } from "node:crypto";
import type {
  DealDocument,
  DealDocumentTransition,
  Prisma,
} from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors/index.js";
import { getEnv } from "../../config/env.js";
import {
  SecurityEventType,
  recordSecurityEvent,
  writeSecurityEvent,
} from "../auth/security-events.js";
import {
  DOCUMENT_EXPIRABLE_STATUSES,
  documentReasonOf,
  documentTransitionTypeFor,
  requireDocumentLegalTransition,
  type DocumentStatus,
} from "./document-state.js";
import { canViewDocument } from "./document-policy.js";
import {
  toPublicDocument,
  toPublicDocumentTransition,
  type PublicDocument,
  type PublicDocumentTransition,
} from "./document.types.js";
import {
  assertExtensionAllowedForType,
  assertMagicMatches,
  canonicalExtensionFor,
  extensionFromFilename,
} from "./document-types.js";
import { documentStorage, storageKeyFor } from "./storage.js";
import type {
  CompleteDocumentBody,
  CreateDocumentBody,
  DocumentQuery,
  ReplaceDocumentBody,
  ReviewDocumentBody,
  SubmitDocumentBody,
  WithdrawDocumentBody,
} from "./document.schemas.js";
import type { DealViewer } from "../negotiation/participant-policy.js";
import type { RequestMeta } from "../organizations/organization.service.js";

type DocumentRow = DealDocument & {
  visibilityParticipants?: Array<{ organizationId: string }>;
};

const DOCUMENT_INCLUDE = {
  visibilityParticipants: true,
} satisfies Prisma.DealDocumentInclude;

/** Documents may be created/replaced while the deal is being negotiated. */
const DEAL_OPERATIONAL_STATUSES: ReadonlySet<string> = new Set([
  "DRAFT",
  "OPEN",
  "NEGOTIATING",
]);

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalDocumentMeta(meta: {
  documentType: string;
  title: string;
  description: string | null;
  visibility: string;
  visibleToOrganizationIds: string[];
}): string {
  return JSON.stringify({
    documentType: meta.documentType,
    title: meta.title,
    description: meta.description,
    visibility: meta.visibility,
    visibleToOrganizationIds: [...meta.visibleToOrganizationIds].sort(),
  });
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function contentTypeFor(ext: string): string {
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

export function assertDealOperational(deal: { status: string }): void {
  if (!DEAL_OPERATIONAL_STATUSES.has(deal.status)) {
    throw AppError.documentInvalidState(
      `Documents can only be created or replaced while the deal is DRAFT, OPEN or NEGOTIATING (current status: ${deal.status}).`,
    );
  }
}

function assertParticipantCanUpload(viewer: DealViewer): void {
  if (viewer.participant.participantType === "OBSERVER") {
    throw AppError.documentAccessDenied(
      "OBSERVER participants cannot upload documents.",
    );
  }
}

/** Fetches a document iff the viewer's org is allowed to see it. */
async function fetchDocumentForViewer(
  dealId: string,
  documentId: string,
  viewer: DealViewer,
): Promise<DocumentRow> {
  const doc = await prisma.dealDocument.findFirst({
    where: { id: documentId, dealId },
    include: DOCUMENT_INCLUDE,
  });
  if (!doc) throw AppError.documentNotFound();
  if (!canViewDocument(doc, viewer.organizationId, viewer.isOwner)) {
    throw AppError.documentNotFound();
  }
  return doc;
}

/**
 * Applies one document status transition atomically: conditional status
 * update, then the append-only transition row. Returns null when the
 * conditional update lost a race (status already moved elsewhere).
 */
async function applyDocumentTransition(
  tx: Prisma.TransactionClient,
  doc: {
    id: string;
    dealId: string;
    organizationId: string;
    status: DocumentStatus;
  },
  toStatus: DocumentStatus,
  requestId: string | null,
  reason: string,
  actorUserId: string | null,
  extra?: Prisma.DealDocumentUncheckedUpdateManyInput,
): Promise<{
  document: DocumentRow | null;
  transition: DealDocumentTransition | null;
}> {
  const applied = await tx.dealDocument.updateMany({
    where: { id: doc.id, status: doc.status },
    data: { status: toStatus, ...(extra ?? {}) },
  });
  if (applied.count === 0) return { document: null, transition: null };
  const transition = await tx.dealDocumentTransition.create({
    data: {
      documentId: doc.id,
      dealId: doc.dealId,
      organizationId: doc.organizationId,
      requestId,
      transitionType: documentTransitionTypeFor(toStatus),
      fromStatus: doc.status,
      toStatus,
      reason,
      actorUserId,
    },
  });
  const updated = await tx.dealDocument.findFirst({
    where: { id: doc.id },
    include: DOCUMENT_INCLUDE,
  });
  return { document: updated ?? null, transition };
}

/** Lazily marks a deadline-passed document EXPIRED (best effort). */
async function lazyExpireBestEffort(
  tx: Prisma.TransactionClient,
  doc: {
    id: string;
    dealId: string;
    organizationId: string;
    status: DocumentStatus;
  },
  actorUserId: string | null,
): Promise<void> {
  const applied = await tx.dealDocument.updateMany({
    where: { id: doc.id, status: doc.status },
    data: { status: "EXPIRED" },
  });
  if (applied.count === 0) return;
  await tx.dealDocumentTransition.create({
    data: {
      documentId: doc.id,
      dealId: doc.dealId,
      organizationId: doc.organizationId,
      requestId: null,
      transitionType: "DOCUMENT_EXPIRED",
      fromStatus: doc.status,
      toStatus: "EXPIRED",
      reason: documentReasonOf("DOCUMENT_EXPIRED"),
      actorUserId,
    },
  });
  await writeSecurityEvent(tx, {
    type: SecurityEventType.DOCUMENT_EXPIRED,
    userId: actorUserId ?? undefined,
    organizationId: doc.organizationId,
    metadata: {
      documentId: doc.id,
      dealId: doc.dealId,
      fromStatus: doc.status,
    },
    ipAddress: null,
    userAgent: null,
  });
}

async function assertNotExpired(
  tx: Prisma.TransactionClient,
  doc: {
    id: string;
    dealId: string;
    organizationId: string;
    status: DocumentStatus;
    expiresAt: Date | null;
  },
  actorUserId: string | null,
): Promise<void> {
  if (doc.expiresAt && doc.expiresAt.getTime() <= Date.now()) {
    await lazyExpireBestEffort(tx, doc, actorUserId);
    throw AppError.documentExpired();
  }
}

export interface DocumentActionResult {
  document: PublicDocument;
  /** Null on a state-level replay (no new transition was written). */
  transition: PublicDocumentTransition | null;
  replay: boolean;
}

/**
 * The chain's materialized current version: the newest completed version.
 * In-flight UPLOADING replacements and SUPERSEDED/EXPIRED versions never
 * shadow the previous live version.
 */
export async function currentChainVersion(
  chainId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<DocumentRow | null> {
  const row = await client.dealDocument.findFirst({
    where: {
      chainId,
      status: { notIn: ["UPLOADING", "SUPERSEDED", "EXPIRED"] },
    },
    orderBy: [{ version: "desc" }, { id: "desc" }],
    include: DOCUMENT_INCLUDE,
  });
  return row;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/** Creates a UPLOADING document row. No bytes travel yet. */
export async function createDocument(
  viewer: DealViewer,
  dealId: string,
  body: CreateDocumentBody,
  actorUserId: string,
  meta: RequestMeta,
): Promise<PublicDocument> {
  assertDealOperational(viewer.deal);
  assertParticipantCanUpload(viewer);

  const payloadHash = sha256(
    canonicalDocumentMeta({
      documentType: body.documentType,
      title: body.title,
      description: body.description ?? null,
      visibility: body.visibility,
      visibleToOrganizationIds: body.visibleToOrganizationIds ?? [],
    }),
  );

  return prisma.$transaction(async (tx) => {
    if (body.idempotencyKey) {
      const keyHash = sha256(body.idempotencyKey);
      const existing = await tx.dealDocument.findFirst({
        where: {
          dealId,
          organizationId: viewer.organizationId,
          idempotencyKeyHash: keyHash,
        },
        include: DOCUMENT_INCLUDE,
        orderBy: { createdAt: "asc" },
      });
      if (existing) {
        if (
          existing.idempotencyPayloadHash &&
          existing.idempotencyPayloadHash !== payloadHash
        ) {
          throw AppError.idempotencyConflict(
            "idempotencyKey was reused with different document content.",
          );
        }
        return toPublicDocument(existing);
      }
    }

    const id = randomUUID();
    const now = new Date();
    const doc = await tx.dealDocument.create({
      data: {
        id,
        dealId,
        organizationId: viewer.organizationId,
        createdByUserId: actorUserId,
        documentType: body.documentType,
        title: body.title,
        description: body.description ?? null,
        visibility: body.visibility,
        status: "UPLOADING",
        chainId: id,
        version: 1,
        expiresAt: new Date(now.getTime() + getEnv().DOCUMENT_UPLOAD_WINDOW_MS),
        idempotencyKeyHash: body.idempotencyKey
          ? sha256(body.idempotencyKey)
          : null,
        idempotencyPayloadHash: payloadHash,
        visibilityParticipants: body.visibleToOrganizationIds?.length
          ? {
              create: body.visibleToOrganizationIds.map((organizationId) => ({
                organizationId,
              })),
            }
          : undefined,
      },
      include: DOCUMENT_INCLUDE,
    });

    await tx.dealDocumentTransition.create({
      data: {
        documentId: doc.id,
        dealId,
        organizationId: viewer.organizationId,
        requestId: null,
        transitionType: "DOCUMENT_CREATED",
        fromStatus: "UPLOADING",
        toStatus: "UPLOADING",
        reason: documentReasonOf("DOCUMENT_CREATED"),
        actorUserId,
      },
    });

    await writeSecurityEvent(tx, {
      type: SecurityEventType.DOCUMENT_CREATED,
      userId: actorUserId,
      organizationId: viewer.organizationId,
      metadata: {
        documentId: doc.id,
        dealId,
        documentType: body.documentType,
        chainId: doc.chainId,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return toPublicDocument(doc);
  });
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export interface UploadInput {
  bytes: Buffer;
  originalFilename: string;
  declaredContentType: string | null;
}

/** Writes the (validated) bytes into storage exactly once, then finalizes. */
export async function uploadDocumentBytes(
  viewer: DealViewer,
  dealId: string,
  documentId: string,
  input: UploadInput,
  actorUserId: string,
  meta: RequestMeta,
): Promise<PublicDocument> {
  const doc = await fetchDocumentForViewer(dealId, documentId, viewer);
  if (doc.organizationId !== viewer.organizationId) {
    throw AppError.documentAccessDenied(
      "Only the uploading organization can store document bytes.",
    );
  }

  const now = new Date();
  if (
    doc.status === "UPLOADING" &&
    doc.expiresAt &&
    doc.expiresAt.getTime() <= now.getTime()
  ) {
    await prisma.$transaction((tx) =>
      lazyExpireBestEffort(tx, doc, actorUserId),
    );
    throw AppError.documentExpired();
  }
  if (doc.status !== "UPLOADING") {
    throw AppError.documentInvalidState(
      `Documents can only receive bytes while UPLOADING (current status: ${doc.status}).`,
    );
  }

  const maxBytes = getEnv().DOCUMENT_MAX_SIZE_BYTES;
  if (input.bytes.length > maxBytes) {
    throw AppError.documentTooLarge();
  }
  const ext = extensionFromFilename(input.originalFilename);
  if (!ext) {
    throw AppError.documentUploadInvalid(
      "The filename must carry a supported extension (.pdf, .png, .jpg, .docx, .xlsx).",
    );
  }
  assertExtensionAllowedForType(ext, doc.documentType);
  assertMagicMatches(input.bytes, ext);

  const sha = sha256(input.bytes);
  const key = storageKeyFor(
    viewer.organizationId,
    dealId,
    documentId,
    doc.version,
    canonicalExtensionFor(ext),
  );
  const contentType = contentTypeFor(ext);

  // Guarded put: store the object, then claim the row. A concurrent double
  // upload loses the claim; the loser cleans up its own object best-effort
  // and reports a clear conflict instead of silently overwriting.
  await documentStorage().put(key, input.bytes);
  const claimed = await prisma.dealDocument.updateMany({
    where: { id: doc.id, status: "UPLOADING", storageKey: null },
    data: {
      storageKey: key,
      originalFilename: input.originalFilename,
      contentType,
      sizeBytes: input.bytes.length,
      sha256: sha,
    },
  });
  if (claimed.count === 0) {
    await documentStorage()
      .delete(key)
      .catch(() => false);
    throw AppError.documentUploadInvalid(
      "Document bytes were already uploaded. Complete or replace instead.",
    );
  }

  const fresh = await fetchDocumentForViewer(dealId, documentId, viewer);
  await recordSecurityEvent({
    type: SecurityEventType.DOCUMENT_UPLOADED,
    userId: actorUserId,
    organizationId: viewer.organizationId,
    metadata: {
      documentId,
      dealId,
      version: doc.version,
      sizeBytes: input.bytes.length,
      contentType,
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return toPublicDocument(fresh);
}

// ---------------------------------------------------------------------------
// Complete
// ---------------------------------------------------------------------------

/** Finalizes a UPLOADING document as UPLOADED (its bytes are stored). */
export async function completeDocument(
  viewer: DealViewer,
  dealId: string,
  documentId: string,
  body: CompleteDocumentBody,
  actorUserId: string,
  meta: RequestMeta,
): Promise<DocumentActionResult> {
  const doc = await fetchDocumentForViewer(dealId, documentId, viewer);
  if (doc.organizationId !== viewer.organizationId) {
    throw AppError.documentAccessDenied(
      "Only the uploading organization can complete this document.",
    );
  }

  // A completed upload is idempotent at the state level: retries return the
  // already-UPLOADED document without error.
  if (doc.status === "UPLOADED") {
    return { document: toPublicDocument(doc), transition: null, replay: true };
  }

  const replay = await prisma.dealDocumentTransition.findFirst({
    where: {
      documentId: doc.id,
      requestId: body.requestId,
      toStatus: "UPLOADED",
    },
    orderBy: { createdAt: "asc" },
  });
  if (replay) {
    return {
      document: toPublicDocument(doc),
      transition: toPublicDocumentTransition(replay),
      replay: true,
    };
  }

  return prisma
    .$transaction(async (tx) => {
      const txReplay = await tx.dealDocumentTransition.findFirst({
        where: {
          documentId: doc.id,
          requestId: body.requestId,
          toStatus: "UPLOADED",
        },
        orderBy: { createdAt: "asc" },
      });
      if (txReplay) {
        return { kind: "replay" as const, transition: txReplay };
      }

      requireDocumentLegalTransition(doc.status, "UPLOADED");
      await assertNotExpired(tx, doc, actorUserId);
      if (!doc.storageKey) {
        throw AppError.documentUploadInvalid(
          "No document bytes were uploaded yet.",
        );
      }
      const exists = await documentStorage().exists(doc.storageKey);
      if (!exists) {
        throw AppError.documentStorageError(
          "The stored object for this document is missing.",
        );
      }

      const applied = await applyDocumentTransition(
        tx,
        doc,
        "UPLOADED",
        body.requestId ?? null,
        documentReasonOf("DOCUMENT_UPLOADED"),
        actorUserId,
      );
      if (!applied.document) return { kind: "race" as const };

      // Promote: the previous version (if any) becomes SUPERSEDED now that the
      // replacement is live.
      if (doc.supersedesId) {
        const parent = await tx.dealDocument.findFirst({
          where: { id: doc.supersedesId },
        });
        if (parent) {
          const superseded = await tx.dealDocument.updateMany({
            where: { id: parent.id, status: parent.status },
            data: { status: "SUPERSEDED" },
          });
          const parentAlreadySuperseded = parent.status === "SUPERSEDED";
          if (superseded.count === 0 && !parentAlreadySuperseded) {
            return { kind: "race" as const };
          }
          if (superseded.count > 0) {
            await tx.dealDocumentTransition.create({
              data: {
                documentId: parent.id,
                dealId: parent.dealId,
                organizationId: parent.organizationId,
                requestId: body.requestId,
                transitionType: "DOCUMENT_SUPERSEDED",
                fromStatus: parent.status,
                toStatus: "SUPERSEDED",
                reason: documentReasonOf("DOCUMENT_SUPERSEDED"),
                actorUserId,
              },
            });
            await writeSecurityEvent(tx, {
              type: SecurityEventType.DOCUMENT_SUPERSEDED,
              userId: actorUserId,
              organizationId: parent.organizationId,
              metadata: {
                documentId: parent.id,
                dealId: parent.dealId,
                supersededByDocumentId: doc.id,
                requestId: body.requestId,
              },
              ipAddress: meta.ipAddress,
              userAgent: meta.userAgent,
            });
          }
        }
      }

      await writeSecurityEvent(tx, {
        type: SecurityEventType.DOCUMENT_UPLOADED,
        userId: actorUserId,
        organizationId: viewer.organizationId,
        metadata: {
          documentId: doc.id,
          dealId,
          version: doc.version,
          supersedesId: doc.supersedesId,
          requestId: body.requestId,
        },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });

      return {
        kind: "changed" as const,
        document: applied.document,
        transition: applied.transition,
      };
    })
    .then((outcome) => {
      if (outcome.kind === "replay") {
        return {
          document: toPublicDocument(doc),
          transition: toPublicDocumentTransition(outcome.transition),
          replay: true,
        };
      }
      if (outcome.kind === "race") throw AppError.documentVersionConflict();
      return {
        document: toPublicDocument(outcome.document as DocumentRow),
        transition: toPublicDocumentTransition(
          outcome.transition as NonNullable<typeof outcome.transition>,
        ),
        replay: false,
      };
    });
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

/** Uploader sends a UPLOADED document to the owner for review. */
export async function submitDocument(
  viewer: DealViewer,
  dealId: string,
  documentId: string,
  body: SubmitDocumentBody,
  actorUserId: string,
  meta: RequestMeta,
): Promise<DocumentActionResult> {
  const doc = await fetchDocumentForViewer(dealId, documentId, viewer);
  if (doc.organizationId !== viewer.organizationId) {
    throw AppError.documentAccessDenied(
      "Only the uploading organization can submit this document.",
    );
  }

  const replay = await prisma.dealDocumentTransition.findFirst({
    where: {
      documentId: doc.id,
      requestId: body.requestId,
      toStatus: "SUBMITTED",
    },
    orderBy: { createdAt: "asc" },
  });
  if (replay) {
    return {
      document: toPublicDocument(doc),
      transition: toPublicDocumentTransition(replay),
      replay: true,
    };
  }

  if (doc.status === "SUBMITTED") {
    throw AppError.documentAlreadySubmitted();
  }

  return prisma
    .$transaction(async (tx) => {
      const txReplay = await tx.dealDocumentTransition.findFirst({
        where: {
          documentId: doc.id,
          requestId: body.requestId,
          toStatus: "SUBMITTED",
        },
        orderBy: { createdAt: "asc" },
      });
      if (txReplay) return { kind: "replay" as const, transition: txReplay };

      requireDocumentLegalTransition(doc.status, "SUBMITTED");
      await assertNotExpired(tx, doc, actorUserId);
      if (!doc.storageKey) {
        throw AppError.documentUploadInvalid(
          "No document bytes were uploaded yet.",
        );
      }

      const now = new Date();
      const applied = await applyDocumentTransition(
        tx,
        doc,
        "SUBMITTED",
        body.requestId ?? null,
        documentReasonOf("DOCUMENT_SUBMITTED"),
        actorUserId,
        {
          submittedAt: now,
          expiresAt: new Date(
            now.getTime() + getEnv().DOCUMENT_REVIEW_WINDOW_MS,
          ),
        },
      );
      if (!applied.document) return { kind: "race" as const };

      await writeSecurityEvent(tx, {
        type: SecurityEventType.DOCUMENT_SUBMITTED,
        userId: actorUserId,
        organizationId: viewer.organizationId,
        metadata: { documentId: doc.id, dealId, requestId: body.requestId },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });

      return {
        kind: "changed" as const,
        document: applied.document,
        transition: applied.transition,
      };
    })
    .then((outcome) => {
      if (outcome.kind === "replay") {
        return {
          document: toPublicDocument(doc),
          transition: toPublicDocumentTransition(outcome.transition),
          replay: true,
        };
      }
      if (outcome.kind === "race") throw AppError.documentVersionConflict();
      return {
        document: toPublicDocument(outcome.document as DocumentRow),
        transition: toPublicDocumentTransition(
          outcome.transition as NonNullable<typeof outcome.transition>,
        ),
        replay: false,
      };
    });
}

// ---------------------------------------------------------------------------
// Withdraw
// ---------------------------------------------------------------------------

/** Uploader pulls a UPLOADED/SUBMITTED document back. */
export async function withdrawDocument(
  viewer: DealViewer,
  dealId: string,
  documentId: string,
  body: WithdrawDocumentBody,
  actorUserId: string,
  meta: RequestMeta,
): Promise<DocumentActionResult> {
  const doc = await fetchDocumentForViewer(dealId, documentId, viewer);
  if (doc.organizationId !== viewer.organizationId) {
    throw AppError.documentAccessDenied(
      "Only the uploading organization can withdraw this document.",
    );
  }

  const replay = await prisma.dealDocumentTransition.findFirst({
    where: {
      documentId: doc.id,
      requestId: body.requestId,
      toStatus: "WITHDRAWN",
    },
    orderBy: { createdAt: "asc" },
  });
  if (replay) {
    return {
      document: toPublicDocument(doc),
      transition: toPublicDocumentTransition(replay),
      replay: true,
    };
  }

  return prisma
    .$transaction(async (tx) => {
      const txReplay = await tx.dealDocumentTransition.findFirst({
        where: {
          documentId: doc.id,
          requestId: body.requestId,
          toStatus: "WITHDRAWN",
        },
        orderBy: { createdAt: "asc" },
      });
      if (txReplay) return { kind: "replay" as const, transition: txReplay };

      requireDocumentLegalTransition(doc.status, "WITHDRAWN");
      await assertNotExpired(tx, doc, actorUserId);

      const applied = await applyDocumentTransition(
        tx,
        doc,
        "WITHDRAWN",
        body.requestId ?? null,
        documentReasonOf("DOCUMENT_WITHDRAWN"),
        actorUserId,
        { expiresAt: null },
      );
      if (!applied.document) return { kind: "race" as const };

      await writeSecurityEvent(tx, {
        type: SecurityEventType.DOCUMENT_WITHDRAWN,
        userId: actorUserId,
        organizationId: viewer.organizationId,
        metadata: { documentId: doc.id, dealId, requestId: body.requestId },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });

      return {
        kind: "changed" as const,
        document: applied.document,
        transition: applied.transition,
      };
    })
    .then((outcome) => {
      if (outcome.kind === "replay") {
        return {
          document: toPublicDocument(doc),
          transition: toPublicDocumentTransition(outcome.transition),
          replay: true,
        };
      }
      if (outcome.kind === "race") throw AppError.documentVersionConflict();
      return {
        document: toPublicDocument(outcome.document as DocumentRow),
        transition: toPublicDocumentTransition(
          outcome.transition as NonNullable<typeof outcome.transition>,
        ),
        replay: false,
      };
    });
}

// ---------------------------------------------------------------------------
// Review (owner-only)
// ---------------------------------------------------------------------------

/** Owner accepts or rejects a SUBMITTED/UNDER_REVIEW document. */
export async function reviewDocument(
  viewer: DealViewer,
  dealId: string,
  documentId: string,
  body: ReviewDocumentBody,
  actorUserId: string,
  meta: RequestMeta,
): Promise<DocumentActionResult> {
  if (!viewer.isOwner) {
    throw AppError.forbidden(
      "Only the deal owner organization can review documents.",
    );
  }
  const doc = await fetchDocumentForViewer(dealId, documentId, viewer);
  const toStatus: DocumentStatus =
    body.decision === "ACCEPT" ? "ACCEPTED" : "REJECTED";

  const replay = await prisma.dealDocumentTransition.findFirst({
    where: { documentId: doc.id, requestId: body.requestId, toStatus },
    orderBy: { createdAt: "asc" },
  });
  if (replay) {
    return {
      document: toPublicDocument(doc),
      transition: toPublicDocumentTransition(replay),
      replay: true,
    };
  }

  return prisma
    .$transaction(async (tx) => {
      const txReplay = await tx.dealDocumentTransition.findFirst({
        where: { documentId: doc.id, requestId: body.requestId, toStatus },
        orderBy: { createdAt: "asc" },
      });
      if (txReplay) return { kind: "replay" as const, transition: txReplay };

      requireDocumentLegalTransition(doc.status, toStatus);
      await assertNotExpired(tx, doc, actorUserId);

      const now = new Date();
      const applied = await applyDocumentTransition(
        tx,
        doc,
        toStatus,
        body.requestId ?? null,
        body.comment
          ? `Document ${body.decision === "ACCEPT" ? "accepted" : "rejected"}: ${body.comment}`
          : documentReasonOf(
              toStatus === "ACCEPTED"
                ? "DOCUMENT_ACCEPTED"
                : "DOCUMENT_REJECTED",
            ),
        actorUserId,
        {
          reviewedAt: now,
          reviewerUserId: actorUserId,
          reviewComment: body.comment ?? null,
          expiresAt:
            toStatus === "ACCEPTED"
              ? new Date(now.getTime() + getEnv().DOCUMENT_REVIEW_WINDOW_MS)
              : null,
        },
      );
      if (!applied.document) return { kind: "race" as const };

      await writeSecurityEvent(tx, {
        type:
          toStatus === "ACCEPTED"
            ? SecurityEventType.DOCUMENT_ACCEPTED
            : SecurityEventType.DOCUMENT_REJECTED,
        userId: actorUserId,
        organizationId: viewer.organizationId,
        metadata: {
          documentId: doc.id,
          dealId,
          requestId: body.requestId,
          reviewComment: body.comment ?? null,
        },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });

      return {
        kind: "changed" as const,
        document: applied.document,
        transition: applied.transition,
      };
    })
    .then((outcome) => {
      if (outcome.kind === "replay") {
        return {
          document: toPublicDocument(doc),
          transition: toPublicDocumentTransition(outcome.transition),
          replay: true,
        };
      }
      if (outcome.kind === "race") throw AppError.documentVersionConflict();
      return {
        document: toPublicDocument(outcome.document as DocumentRow),
        transition: toPublicDocumentTransition(
          outcome.transition as NonNullable<typeof outcome.transition>,
        ),
        replay: false,
      };
    });
}

// ---------------------------------------------------------------------------
// Replace
// ---------------------------------------------------------------------------

/**
 * Starts a replacement version of the current materialized version. The child
 * is born UPLOADING; the parent is marked SUPERSEDED only when the child
 * completes (see completeDocument).
 */
export async function replaceDocument(
  viewer: DealViewer,
  dealId: string,
  documentId: string,
  body: ReplaceDocumentBody,
  actorUserId: string,
  meta: RequestMeta,
): Promise<PublicDocument> {
  assertDealOperational(viewer.deal);
  assertParticipantCanUpload(viewer);

  const current = await fetchDocumentForViewer(dealId, documentId, viewer);
  if (current.organizationId !== viewer.organizationId) {
    throw AppError.documentAccessDenied(
      "Only the uploading organization can replace a document.",
    );
  }
  if (current.status === "UPLOADING") {
    throw AppError.documentInvalidState(
      "The current version is still uploading. Complete it before replacing.",
    );
  }
  const chainCurrent = await currentChainVersion(current.chainId);
  if (!chainCurrent || chainCurrent.id !== current.id) {
    throw AppError.documentVersionConflict(
      "Only the most recent version of the document can be replaced.",
    );
  }
  // One replacement at a time: a live UPLOADING child blocks a new fork.
  const inFlight = await prisma.dealDocument.findFirst({
    where: {
      chainId: current.chainId,
      status: "UPLOADING",
      supersedesId: { not: null },
    },
  });
  if (inFlight) {
    throw AppError.documentVersionConflict(
      "A replacement version is already being prepared.",
    );
  }

  const resolvedVisibleTo =
    body.visibleToOrganizationIds ??
    current.visibilityParticipants?.map((g) => g.organizationId) ??
    [];
  const resolvedMeta: {
    documentType: string;
    title: string;
    description: string | null;
    visibility: DealDocument["visibility"];
    visibleToOrganizationIds: string[];
  } = {
    documentType: body.documentType ?? current.documentType,
    title: body.title ?? current.title,
    description:
      body.description !== undefined ? body.description : current.description,
    visibility: body.visibility ?? current.visibility,
    visibleToOrganizationIds: resolvedVisibleTo,
  };
  const payloadHash = sha256(canonicalDocumentMeta(resolvedMeta));
  const keyHash = body.idempotencyKey ? sha256(body.idempotencyKey) : null;

  const createChild = async (
    tx: Prisma.TransactionClient,
  ): Promise<DocumentRow> => {
    const childId = randomUUID();
    try {
      return await tx.dealDocument.create({
        data: {
          id: childId,
          dealId,
          organizationId: viewer.organizationId,
          createdByUserId: actorUserId,
          documentType: resolvedMeta.documentType,
          title: resolvedMeta.title,
          description: resolvedMeta.description,
          visibility: resolvedMeta.visibility,
          status: "UPLOADING",
          chainId: current.chainId,
          version: current.version + 1,
          supersedesId: current.id,
          expiresAt: new Date(Date.now() + getEnv().DOCUMENT_UPLOAD_WINDOW_MS),
          idempotencyKeyHash: keyHash,
          idempotencyPayloadHash: payloadHash,
          visibilityParticipants: resolvedMeta.visibleToOrganizationIds.length
            ? {
                create: resolvedMeta.visibleToOrganizationIds.map(
                  (organizationId) => ({ organizationId }),
                ),
              }
            : undefined,
        },
        include: DOCUMENT_INCLUDE,
      });
    } catch (err) {
      if (
        (err as { code?: string }).code === "P2002" &&
        Array.isArray((err as { meta?: { target?: unknown } }).meta?.target) &&
        ((err as { meta?: { target?: string[] } }).meta?.target ?? []).some(
          (t) => t.includes("chainId") && t.includes("version"),
        )
      ) {
        throw AppError.documentVersionConflict(
          "A concurrent replacement consumed this version slot.",
        );
      }
      throw err;
    }
  };

  const existing = await prisma.dealDocument.findFirst({
    where: {
      dealId,
      organizationId: viewer.organizationId,
      idempotencyKeyHash: keyHash ?? "__never__",
    },
    include: DOCUMENT_INCLUDE,
    orderBy: { createdAt: "asc" },
  });
  if (keyHash && existing) {
    if (existing.chainId !== current.chainId) {
      throw AppError.idempotencyConflict(
        "idempotencyKey was used for a different document in this deal.",
      );
    }
    if (existing.supersedesId !== current.id) {
      throw AppError.idempotencyConflict(
        "idempotencyKey was already used for another operation on this chain.",
      );
    }
    if (
      existing.idempotencyPayloadHash &&
      existing.idempotencyPayloadHash !== payloadHash
    ) {
      throw AppError.idempotencyConflict(
        "idempotencyKey was reused with different replacement content.",
      );
    }
    return toPublicDocument(existing);
  }

  return prisma.$transaction(async (tx) => {
    const txReplay = await tx.dealDocument.findFirst({
      where: {
        dealId,
        organizationId: viewer.organizationId,
        idempotencyKeyHash: keyHash ?? "__never__",
      },
      include: DOCUMENT_INCLUDE,
      orderBy: { createdAt: "asc" },
    });
    if (keyHash && txReplay) {
      if (
        txReplay.chainId !== current.chainId ||
        txReplay.supersedesId !== current.id
      ) {
        throw AppError.idempotencyConflict(
          "idempotencyKey is not replayable for this replacement.",
        );
      }
      if (
        txReplay.idempotencyPayloadHash &&
        txReplay.idempotencyPayloadHash !== payloadHash
      ) {
        throw AppError.idempotencyConflict(
          "idempotencyKey was reused with different replacement content.",
        );
      }
      return toPublicDocument(txReplay);
    }

    const child = await createChild(tx);
    await tx.dealDocumentTransition.create({
      data: {
        documentId: child.id,
        dealId,
        organizationId: viewer.organizationId,
        requestId: body.requestId ?? null,
        transitionType: "DOCUMENT_CREATED",
        fromStatus: "UPLOADING",
        toStatus: "UPLOADING",
        reason: `Replacement version ${child.version} of ${current.chainId}.`,
        actorUserId,
      },
    });
    await writeSecurityEvent(tx, {
      type: SecurityEventType.DOCUMENT_REPLACED,
      userId: actorUserId,
      organizationId: viewer.organizationId,
      metadata: {
        documentId: child.id,
        dealId,
        chainId: child.chainId,
        version: child.version,
        supersedesId: current.id,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return toPublicDocument(child);
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getDocument(
  viewer: DealViewer,
  dealId: string,
  documentId: string,
): Promise<PublicDocument> {
  const doc = await fetchDocumentForViewer(dealId, documentId, viewer);
  return toPublicDocument(doc);
}

/** Paginated documents the viewer's org may see inside the deal. */
export async function listDocuments(
  viewer: DealViewer,
  dealId: string,
  query: DocumentQuery,
): Promise<{
  documents: PublicDocument[];
  total: number;
  page: number;
  limit: number;
}> {
  const where: Prisma.DealDocumentWhereInput = {
    dealId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.visibility ? { visibility: query.visibility } : {}),
    ...(query.documentType ? { documentType: query.documentType } : {}),
    ...(viewer.isOwner
      ? {}
      : {
          OR: [
            { organizationId: viewer.organizationId },
            { visibility: "PARTICIPANTS" },
            {
              visibility: "SPECIFIC_PARTICIPANTS",
              visibilityParticipants: {
                some: { organizationId: viewer.organizationId },
              },
            },
          ],
        }),
  };
  const skip = (query.page - 1) * query.limit;
  const [rows, total] = await prisma.$transaction([
    prisma.dealDocument.findMany({
      where,
      include: DOCUMENT_INCLUDE,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take: query.limit,
    }),
    prisma.dealDocument.count({ where }),
  ]);
  return {
    documents: rows.map((row) => toPublicDocument(row)),
    total,
    page: query.page,
    limit: query.limit,
  };
}

/** All versions of a document chain (visibility applies to the whole chain). */
export async function listVersions(
  viewer: DealViewer,
  dealId: string,
  documentId: string,
): Promise<{ chainId: string; versions: PublicDocument[] }> {
  const doc = await fetchDocumentForViewer(dealId, documentId, viewer);
  const rows = await prisma.dealDocument.findMany({
    where: { chainId: doc.chainId },
    include: DOCUMENT_INCLUDE,
    orderBy: [{ version: "asc" }, { id: "asc" }],
  });
  return {
    chainId: doc.chainId,
    versions: rows.map((row) => toPublicDocument(row)),
  };
}

export interface DownloadResult {
  bytes: Buffer;
  contentType: string;
  originalFilename: string;
}

/** Streams the stored object for a visible, fully-uploaded document. */
export async function downloadDocument(
  viewer: DealViewer,
  dealId: string,
  documentId: string,
  meta: RequestMeta,
): Promise<DownloadResult> {
  const doc = await fetchDocumentForViewer(dealId, documentId, viewer);
  if (doc.status === "UPLOADING") {
    throw AppError.documentNotReady("The document has not been uploaded yet.");
  }
  if (!doc.storageKey) {
    throw AppError.documentStorageError(
      "The stored object for this document is missing.",
    );
  }
  const bytes = await documentStorage().get(doc.storageKey);

  await recordSecurityEvent({
    type: SecurityEventType.DOCUMENT_DOWNLOAD_REQUESTED,
    userId: undefined,
    organizationId: viewer.organizationId,
    metadata: {
      documentId: doc.id,
      dealId,
      version: doc.version,
      viewerOrganizationId: viewer.organizationId,
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return {
    bytes,
    contentType: doc.contentType ?? "application/octet-stream",
    originalFilename:
      doc.originalFilename ??
      `${doc.title.replace(/[^a-z0-9._-]+/gi, "-")}-v${doc.version}`,
  };
}

// ---------------------------------------------------------------------------
// Expiry worker
// ---------------------------------------------------------------------------

/**
 * System worker: expires documents whose deadline passed. Safe to run
 * concurrently and to re-run. Abortive UPLOADING replacements are EXPIRED
 * without touching their live parent.
 */
export async function expireEligibleDocuments(
  now: Date = new Date(),
  batchSize = 100,
): Promise<number> {
  const candidates = await prisma.dealDocument.findMany({
    where: {
      expiresAt: { lt: now },
      status: { in: [...DOCUMENT_EXPIRABLE_STATUSES] },
    },
    select: {
      id: true,
      dealId: true,
      organizationId: true,
      status: true,
      expiresAt: true,
      chainId: true,
      version: true,
      supersedesId: true,
    },
    take: batchSize,
  });

  let expired = 0;
  for (const candidate of candidates) {
    try {
      const changed = await prisma.$transaction(async (tx) => {
        const applied = await tx.dealDocument.updateMany({
          where: { id: candidate.id, status: candidate.status },
          data: { status: "EXPIRED" },
        });
        if (applied.count === 0) return false;
        await tx.dealDocumentTransition.create({
          data: {
            documentId: candidate.id,
            dealId: candidate.dealId,
            organizationId: candidate.organizationId,
            requestId: `system:expire:doc:${candidate.id}`,
            transitionType: "DOCUMENT_EXPIRED",
            fromStatus: candidate.status,
            toStatus: "EXPIRED",
            reason:
              `System expiry: document window passed ` +
              `(${candidate.expiresAt?.toISOString() ?? "unknown"}).`,
            actorUserId: null,
          },
        });
        await writeSecurityEvent(tx, {
          type: SecurityEventType.DOCUMENT_EXPIRED,
          userId: undefined,
          organizationId: candidate.organizationId,
          metadata: {
            documentId: candidate.id,
            dealId: candidate.dealId,
            chainId: candidate.chainId,
            version: candidate.version,
            fromStatus: candidate.status,
            supersedesId: candidate.supersedesId,
            reason: "Document window passed.",
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
