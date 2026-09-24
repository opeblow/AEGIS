import { AppError } from "../../lib/errors/index.js";
import type { DocumentStatus as PrismaDocumentStatus } from "@prisma/client";

// ---------------------------------------------------------------------------
// Document state machine (Phase 6)
//
// A single source of truth for how documents move. Statuses never change
// through a free-form write — every move appends a DealDocumentTransition row
// and goes through the conditional status update in document.service.ts.
//
//   UPLOADING    -> UPLOADED, EXPIRED (upload window passed)
//   UPLOADED     -> SUBMITTED, WITHDRAWN, EXPIRED
//   SUBMITTED    -> UNDER_REVIEW, ACCEPTED, REJECTED, WITHDRAWN, EXPIRED
//   UNDER_REVIEW -> ACCEPTED, REJECTED, EXPIRED
//   ACCEPTED     -> EXPIRED (retention window passed)
//   REJECTED / WITHDRAWN / EXPIRED / SUPERSEDED: terminal.
//
// SUPERSEDED is applied to the previous current version when a replacement
// version completes its upload (see document.service.ts replace/complete).
// ---------------------------------------------------------------------------

export type DocumentStatus = PrismaDocumentStatus;

export const DOCUMENT_STATUSES: readonly DocumentStatus[] = [
  "UPLOADING",
  "UPLOADED",
  "SUBMITTED",
  "UNDER_REVIEW",
  "ACCEPTED",
  "REJECTED",
  "EXPIRED",
  "WITHDRAWN",
  "SUPERSEDED",
];

const NO_EDGE: ReadonlySet<DocumentStatus> = new Set();

const DOCUMENT_TRANSITIONS: Readonly<
  Record<DocumentStatus, ReadonlySet<DocumentStatus>>
> = {
  UPLOADING: new Set(["UPLOADED", "EXPIRED"]),
  UPLOADED: new Set(["SUBMITTED", "WITHDRAWN", "EXPIRED"]),
  SUBMITTED: new Set([
    "UNDER_REVIEW",
    "ACCEPTED",
    "REJECTED",
    "WITHDRAWN",
    "EXPIRED",
  ]),
  UNDER_REVIEW: new Set(["ACCEPTED", "REJECTED", "EXPIRED"]),
  ACCEPTED: new Set(["EXPIRED"]),
  REJECTED: NO_EDGE,
  EXPIRED: NO_EDGE,
  WITHDRAWN: NO_EDGE,
  SUPERSEDED: NO_EDGE,
};

/** Statuses that may be lazily expired by the worker/action path. */
export const DOCUMENT_EXPIRABLE_STATUSES: readonly DocumentStatus[] = [
  "UPLOADING",
  "UPLOADED",
  "SUBMITTED",
  "UNDER_REVIEW",
  "ACCEPTED",
];

/**
 * Whether a version counts as the chain's "current" version. A version is
 * current unless it is still UPLOADING (replacement not materialized yet),
 * SUPERSEDED (a newer version completed), or EXPIRED (the whole document died
 * or an abandoned replacement never landed). Including EXPIRED keeps a dead
 * abortive replacement from shadowing its live parent.
 */
export function isCurrentVersionStatus(status: DocumentStatus): boolean {
  return (
    status !== "UPLOADING" && status !== "SUPERSEDED" && status !== "EXPIRED"
  );
}

export function isDocumentLegalTransition(
  from: DocumentStatus,
  to: DocumentStatus,
): boolean {
  if (from === to) return false;
  const allowed = DOCUMENT_TRANSITIONS[from];
  return allowed !== undefined && allowed.has(to);
}

export function requireDocumentLegalTransition(
  from: DocumentStatus,
  to: DocumentStatus,
): void {
  if (!isDocumentLegalTransition(from, to)) {
    throw AppError.documentInvalidTransition(
      `Invalid document transition: ${from} -> ${to} is not permitted.`,
    );
  }
}

/** Wire event label for the transition target (mirrors offer-state naming). */
export function documentTransitionTypeFor(to: DocumentStatus): string {
  switch (to) {
    case "UPLOADED":
      return "DOCUMENT_UPLOADED";
    case "SUBMITTED":
      return "DOCUMENT_SUBMITTED";
    case "UNDER_REVIEW":
      return "DOCUMENT_UNDER_REVIEW";
    case "ACCEPTED":
      return "DOCUMENT_ACCEPTED";
    case "REJECTED":
      return "DOCUMENT_REJECTED";
    case "EXPIRED":
      return "DOCUMENT_EXPIRED";
    case "WITHDRAWN":
      return "DOCUMENT_WITHDRAWN";
    case "SUPERSEDED":
      return "DOCUMENT_SUPERSEDED";
    default:
      return "DOCUMENT_CREATED";
  }
}

export function documentReasonOf(transitionType: string): string {
  switch (transitionType) {
    case "DOCUMENT_CREATED":
      return "Document version created.";
    case "DOCUMENT_UPLOADED":
      return "Document bytes uploaded and finalized.";
    case "DOCUMENT_SUBMITTED":
      return "Document submitted for review.";
    case "DOCUMENT_UNDER_REVIEW":
      return "Document accepted into review.";
    case "DOCUMENT_ACCEPTED":
      return "Document accepted by the deal owner.";
    case "DOCUMENT_REJECTED":
      return "Document rejected by the deal owner.";
    case "DOCUMENT_EXPIRED":
      return "Document window passed.";
    case "DOCUMENT_WITHDRAWN":
      return "Document withdrawn.";
    case "DOCUMENT_SUPERSEDED":
      return "Document superseded by a newer version.";
    default:
      return "Document status changed.";
  }
}
