import type {
  DealDocument,
  DealDocumentTransition,
  DealRequirement,
  DealRequirementTransition,
} from "@prisma/client";
import { isCurrentVersionStatus } from "./document-state.js";

// ---------------------------------------------------------------------------
// Public document shapes (Phase 6)
//
// Storage internals (storageKey) and checksums of this shape are safe to
// expose — but storageKey is genuinely NEVER exposed, and bytes never travel
// outside the download endpoint.
// ---------------------------------------------------------------------------

type DocumentRow = DealDocument & {
  visibilityParticipants?: Array<{ organizationId: string }>;
};

export interface PublicDocument {
  id: string;
  dealId: string;
  organizationId: string;
  createdByUserId: string;
  documentType: string;
  title: string;
  description: string | null;
  visibility: DealDocument["visibility"];
  visibleToOrganizationIds: string[];
  status: DealDocument["status"];
  chainId: string;
  version: number;
  supersedesId: string | null;
  /** Whether the bytes for this version have been received. */
  hasContent: boolean;
  originalFilename: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  expiresAt: string | null;
  reviewerUserId: string | null;
  reviewComment: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toPublicDocument(row: DocumentRow): PublicDocument {
  return {
    id: row.id,
    dealId: row.dealId,
    organizationId: row.organizationId,
    createdByUserId: row.createdByUserId,
    documentType: row.documentType,
    title: row.title,
    description: row.description,
    visibility: row.visibility,
    visibleToOrganizationIds:
      row.visibilityParticipants?.map((g) => g.organizationId) ?? [],
    status: row.status,
    chainId: row.chainId,
    version: row.version,
    supersedesId: row.supersedesId,
    hasContent: row.storageKey !== null,
    originalFilename: row.originalFilename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    reviewerUserId: row.reviewerUserId,
    reviewComment: row.reviewComment,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface PublicDocumentTransition {
  id: string;
  documentId: string;
  dealId: string;
  requestId: string | null;
  transitionType: string;
  fromStatus: DealDocument["status"];
  toStatus: DealDocument["status"];
  reason: string | null;
  actorUserId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export function toPublicDocumentTransition(
  row: DealDocumentTransition,
): PublicDocumentTransition {
  return {
    id: row.id,
    documentId: row.documentId,
    dealId: row.dealId,
    requestId: row.requestId,
    transitionType: row.transitionType,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    reason: row.reason,
    actorUserId: row.actorUserId,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Requirements
// ---------------------------------------------------------------------------

type RequirementRow = DealRequirement & {
  documents?: Array<{ documentGroupId: string }>;
};

export interface PublicRequirement {
  id: string;
  dealId: string;
  organizationId: string;
  createdByUserId: string;
  requirementType: DealRequirement["requirementType"];
  title: string;
  description: string | null;
  status: DealRequirement["status"];
  required: boolean;
  dueAt: string | null;
  assignedOrganizationId: string | null;
  satisfiedAt: string | null;
  satisfiedByUserId: string | null;
  rejectionReason: string | null;
  waivedAt: string | null;
  waivedByUserId: string | null;
  documentGroups: string[];
  createdAt: string;
  updatedAt: string;
}

export function toPublicRequirement(row: RequirementRow): PublicRequirement {
  return {
    id: row.id,
    dealId: row.dealId,
    organizationId: row.organizationId,
    createdByUserId: row.createdByUserId,
    requirementType: row.requirementType,
    title: row.title,
    description: row.description,
    status: row.status,
    required: row.required,
    dueAt: row.dueAt?.toISOString() ?? null,
    assignedOrganizationId: row.assignedOrganizationId,
    satisfiedAt: row.satisfiedAt?.toISOString() ?? null,
    satisfiedByUserId: row.satisfiedByUserId,
    rejectionReason: row.rejectionReason,
    waivedAt: row.waivedAt?.toISOString() ?? null,
    waivedByUserId: row.waivedByUserId,
    documentGroups: row.documents?.map((d) => d.documentGroupId) ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface PublicRequirementTransition {
  id: string;
  requirementId: string;
  dealId: string;
  requestId: string | null;
  transitionType: string;
  fromStatus: DealRequirement["status"];
  toStatus: DealRequirement["status"];
  reason: string | null;
  actorUserId: string | null;
  createdAt: string;
}

export function toPublicRequirementTransition(
  row: DealRequirementTransition,
): PublicRequirementTransition {
  return {
    id: row.id,
    requirementId: row.requirementId,
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

// ---------------------------------------------------------------------------
// Deal readiness
// ---------------------------------------------------------------------------

export interface ReadinessRequirement {
  id: string;
  title: string;
  requirementType: DealRequirement["requirementType"];
  required: boolean;
  status: DealRequirement["status"];
  satisfied: boolean;
}

export interface PublicReadiness {
  dealId: string;
  /** Required (blocking) requirements in scope (WAIVED excluded). */
  required: number;
  satisfied: number;
  outstanding: number;
  /** True when at least one required requirement is outstanding. */
  blocked: boolean;
  requirements: ReadinessRequirement[];
}

export function isCurrentVersion(row: DealDocument): boolean {
  return isCurrentVersionStatus(row.status);
}
