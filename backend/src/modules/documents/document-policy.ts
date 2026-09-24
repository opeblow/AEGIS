import type { DealDocument } from "@prisma/client";
import { AppError } from "../../lib/errors/index.js";

// ---------------------------------------------------------------------------
// Document access policy (Phase 6)
//
// A document is viewable by:
//   - the organization that uploaded it (always)
//   - the deal owner organization (always)
//   - plus whatever the document's `visibility` window grants:
//       PRIVATE              : uploader only (owner is covered by the rule above)
//       DEAL_OWNER           : owner organization only
//       PARTICIPANTS         : all deal participants
//       SPECIFIC_PARTICIPANTS: the organizations listed in visibilityParticipants
//
// Visibility is conservative: cross-tenant document ids must NEVER leak
// existence, so callers resolve "not visible" as DOCUMENT_NOT_FOUND (404), the
// same answer a genuinely missing id returns.
// ---------------------------------------------------------------------------

export type VisibilityRow = Pick<
  DealDocument,
  "organizationId" | "visibility"
> & { visibilityParticipants?: Array<{ organizationId: string }> };

export function canViewDocument(
  doc: VisibilityRow,
  viewerOrganizationId: string,
  viewerIsOwner: boolean,
): boolean {
  // Always-allowed principals: uploader organization and owner organization.
  if (doc.organizationId === viewerOrganizationId || viewerIsOwner) {
    return true;
  }
  switch (doc.visibility) {
    case "PRIVATE":
    case "DEAL_OWNER":
      return false;
    case "PARTICIPANTS":
      // The viewer is an ACTIVE participant by construction (resolveDealViewer).
      return true;
    case "SPECIFIC_PARTICIPANTS":
      return (
        doc.visibilityParticipants?.some(
          (grant) => grant.organizationId === viewerOrganizationId,
        ) ?? false
      );
    default:
      return false;
  }
}

/** Resolves a not-visible document to the same 404 as a missing one. */
export function documentAccessError(): AppError {
  return AppError.documentNotFound();
}
