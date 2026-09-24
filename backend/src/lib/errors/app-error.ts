export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "DATABASE_ERROR"
  | "INTERNAL_SERVER_ERROR"
  | "INVITATION_EXPIRED"
  | "INVITATION_REVOKED"
  | "INVITATION_ALREADY_ACCEPTED"
  | "MEMBERSHIP_SUSPENDED"
  | "OWNER_REQUIRED"
  | "DEAL_NOT_FOUND"
  | "INVALID_DEAL_STATE"
  | "INVALID_DEAL_TRANSITION"
  | "DEAL_VERSION_CONFLICT"
  | "DEAL_IDEMPOTENCY_CONFLICT"
  | "INVALID_MONEY_AMOUNT"
  | "INVALID_CURRENCY"
  | "INVALID_DEADLINE"
  // Counterparties & negotiation (Phase 5)
  | "COUNTERPARTY_NOT_FOUND"
  | "COUNTERPARTY_SELF"
  | "COUNTERPARTY_ALREADY_EXISTS"
  | "COUNTERPARTY_INVALID_TRANSITION"
  | "DEAL_PARTICIPANT_NOT_FOUND"
  | "DEAL_PARTICIPANT_NOT_ACTIVE"
  | "DEAL_PARTICIPANT_ALREADY_EXISTS"
  | "DEAL_PARTICIPANT_OWNER_IMMUTABLE"
  | "DEAL_PARTICIPANT_VERSION_CONFLICT"
  | "DEAL_PARTICIPANT_IDEMPOTENCY_CONFLICT"
  | "DEAL_INVITATION_EXPIRED"
  | "DEAL_INVITATION_REVOKED"
  | "DEAL_INVITATION_ALREADY_USED"
  | "OFFER_NOT_FOUND"
  | "OFFER_INVALID_STATE"
  | "OFFER_INVALID_TRANSITION"
  | "OFFER_EXPIRED"
  | "OFFER_CONCURRENCY_CONFLICT"
  | "OFFER_IDEMPOTENCY_CONFLICT"
  | "OFFER_RECIPIENT_INVALID"
  // Documents & deal requirements (Phase 6)
  | "DOCUMENT_NOT_FOUND"
  | "DOCUMENT_NOT_VISIBLE"
  | "DOCUMENT_ACCESS_DENIED"
  | "DOCUMENT_UPLOAD_INVALID"
  | "DOCUMENT_TOO_LARGE"
  | "DOCUMENT_TYPE_NOT_ALLOWED"
  | "DOCUMENT_NOT_READY"
  | "DOCUMENT_ALREADY_SUBMITTED"
  | "DOCUMENT_INVALID_STATE"
  | "DOCUMENT_INVALID_TRANSITION"
  | "DOCUMENT_EXPIRED"
  | "DOCUMENT_VERSION_CONFLICT"
  | "DOCUMENT_STORAGE_ERROR"
  | "REQUIREMENT_NOT_FOUND"
  | "REQUIREMENT_NOT_VISIBLE"
  | "REQUIREMENT_INVALID_STATE"
  | "REQUIREMENT_INVALID_TRANSITION"
  | "REQUIREMENT_NOT_ASSIGNED"
  | "REQUIREMENT_ALREADY_SATISFIED"
  | "REQUIREMENT_DOCUMENT_INVALID"
  | "REQUIREMENT_NOT_READY"
  // Approval Engine (Phase 7)
  | "APPROVAL_POLICY_NOT_FOUND"
  | "APPROVAL_POLICY_INACTIVE"
  | "APPROVAL_POLICY_CONFLICT"
  | "APPROVAL_WORKFLOW_NOT_FOUND"
  | "APPROVAL_WORKFLOW_ALREADY_ACTIVE"
  | "APPROVAL_WORKFLOW_INVALID_STATE"
  | "APPROVAL_REQUEST_NOT_FOUND"
  | "APPROVAL_REQUEST_NOT_ASSIGNED"
  | "APPROVAL_REQUEST_INVALID_STATE"
  | "APPROVAL_NOT_AUTHORIZED"
  | "APPROVAL_REQUIREMENTS_INCOMPLETE"
  | "APPROVAL_SOD_VIOLATION"
  | "APPROVAL_SEQUENCE_BLOCKED"
  | "APPROVAL_APPROVER_ALREADY_ASSIGNED"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_ALREADY_DECIDED"
  | "APPROVAL_CONCURRENCY_CONFLICT"
  | "APPROVAL_REAPPROVAL_REQUIRED"
  | "APPROVAL_POLICY_EVALUATION_FAILED"
  // Settlement & Reconciliation (Phase 8)
  | "SETTLEMENT_NOT_READY"
  | "SETTLEMENT_ALREADY_ACTIVE"
  | "SETTLEMENT_ALREADY_COMPLETED"
  | "SETTLEMENT_NOT_FOUND"
  | "SETTLEMENT_NOT_AUTHORIZED"
  | "SETTLEMENT_PROVIDER_UNAVAILABLE"
  | "SETTLEMENT_PROVIDER_ERROR"
  | "SETTLEMENT_IDEMPOTENCY_CONFLICT"
  | "SETTLEMENT_CONCURRENCY_CONFLICT"
  | "SETTLEMENT_STATE_CONFLICT"
  | "SETTLEMENT_REFERENCE_CONFLICT"
  | "RECONCILIATION_NOT_FOUND"
  | "RECONCILIATION_MISMATCH"
  | "RECONCILIATION_NOT_AUTHORIZED"
  | "RECONCILIATION_ALREADY_RESOLVED"
  | "RECONCILIATION_STATE_CONFLICT"
  // Deal Intelligence (Phase 9)
  | "AI_SERVICE_UNAVAILABLE"
  | "AI_SERVICE_TIMEOUT"
  | "AI_SERVICE_UNAUTHORIZED"
  | "AI_INVALID_RESPONSE"
  | "AI_ANALYSIS_FAILED"
  | "AI_INPUT_TOO_LARGE"
  | "AI_QUERY_OUT_OF_SCOPE"
  | "AI_RATE_LIMITED"
  | "AI_ANALYSIS_NOT_FOUND"
  | "AI_NOT_AUTHORIZED"
  // Quantum Optimization (Phase 10)
  | "QUANTUM_SERVICE_UNAVAILABLE"
  | "QUANTUM_SERVICE_TIMEOUT"
  | "QUANTUM_SERVICE_UNAUTHORIZED"
  | "QUANTUM_INVALID_RESPONSE"
  | "QUANTUM_OPTIMIZATION_FAILED"
  | "QUANTUM_INPUT_TOO_LARGE"
  | "QUANTUM_PROBLEM_REJECTED"
  | "QUANTUM_OPTIMIZATION_NOT_FOUND"
  | "QUANTUM_NOT_AUTHORIZED"
  // OneSwap integration (Phase 11)
  | "ONESWAP_API_ERROR"
  | "ONESWAP_TIMEOUT"
  | "ONESWAP_NETWORK"
  | "ONESWAP_NOT_CONFIGURED"
  | "ONESWAP_RATE_LIMITED"
  | "ONESWAP_OPERATION_UNSUPPORTED"
  | "ONESWAP_IDEMPOTENCY_CONFLICT"
  | "ONESWAP_OPERATION_NOT_FOUND";

/**
 * Application error carrying an HTTP status, a stable machine-readable code,
 * and a client-safe message. Future modules throw these directly so the
 * centralized error handler can serialize them predictably.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(opts: {
    statusCode: number;
    code: ErrorCode;
    message: string;
    details?: unknown;
    /** Whether the message is safe to return to the client. Default true. */
    expose?: boolean;
    cause?: unknown;
  }) {
    super(opts.message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = "AppError";
    this.statusCode = opts.statusCode;
    this.code = opts.code;
    this.details = opts.details;
    this.expose = opts.expose ?? true;
  }

  static validation(message: string, details?: unknown): AppError {
    return new AppError({
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message,
      details,
    });
  }

  static unauthorized(message = "Authentication required."): AppError {
    return new AppError({
      statusCode: 401,
      code: "UNAUTHORIZED",
      message,
    });
  }

  static forbidden(
    message = "You are not allowed to perform this action.",
  ): AppError {
    return new AppError({
      statusCode: 403,
      code: "FORBIDDEN",
      message,
    });
  }

  static notFound(message = "Resource not found."): AppError {
    return new AppError({
      statusCode: 404,
      code: "NOT_FOUND",
      message,
    });
  }

  static conflict(
    message = "The request conflicts with the current state.",
  ): AppError {
    return new AppError({
      statusCode: 409,
      code: "CONFLICT",
      message,
    });
  }

  static tooMany(
    message = "Too many requests. Please try again later.",
  ): AppError {
    return new AppError({
      statusCode: 429,
      code: "RATE_LIMITED",
      message,
    });
  }

  static database(
    message = "Database operation failed.",
    cause?: unknown,
  ): AppError {
    return new AppError({
      statusCode: 500,
      code: "DATABASE_ERROR",
      message,
      expose: false,
      cause,
    });
  }

  /**
   * The authenticated user's organization membership is suspended. 403.
   */
  static membershipSuspended(
    message = "This membership is suspended.",
  ): AppError {
    return new AppError({
      statusCode: 403,
      code: "MEMBERSHIP_SUSPENDED",
      message,
    });
  }

  /** The invitation the caller knows about has expired. 410. */
  static invitationExpired(message = "This invitation has expired."): AppError {
    return new AppError({
      statusCode: 410,
      code: "INVITATION_EXPIRED",
      message,
    });
  }

  /** The invitation the caller knows about was revoked. 409. */
  static invitationRevoked(
    message = "This invitation has been revoked.",
  ): AppError {
    return new AppError({
      statusCode: 409,
      code: "INVITATION_REVOKED",
      message,
    });
  }

  /** The invitation the caller knows about was already accepted. 409. */
  static invitationAccepted(
    message = "This invitation has already been accepted.",
  ): AppError {
    return new AppError({
      statusCode: 409,
      code: "INVITATION_ALREADY_ACCEPTED",
      message,
    });
  }

  /**
   * An operation requires an organization owner (e.g. ownership transfer) or
   * would violate the at-least-one-owner invariant. 403.
   */
  static ownerRequired(
    message = "An organization owner is required for this action.",
  ): AppError {
    return new AppError({
      statusCode: 403,
      code: "OWNER_REQUIRED",
      message,
    });
  }

  // -------------------------------------------------------------------------
  // Deals (Phase 4)
  // -------------------------------------------------------------------------

  /** A deal does not exist in the caller's organization scope. 404. Safe to
   *  return for both genuinely-missing ids and ids owned by another tenant. */
  static dealNotFound(message = "Deal not found."): AppError {
    return new AppError({
      statusCode: 404,
      code: "DEAL_NOT_FOUND",
      message,
    });
  }

  /** The machine forbids a move between the current and target status. 409. */
  static invalidDealTransition(message: string): AppError {
    return new AppError({
      statusCode: 409,
      code: "INVALID_DEAL_TRANSITION",
      message,
    });
  }

  /** The deal's current state blocks the operation (e.g. terminal status). 409. */
  static invalidDealState(message: string): AppError {
    return new AppError({
      statusCode: 409,
      code: "INVALID_DEAL_STATE",
      message,
    });
  }

  /** Optimistic-concurrency guard: the caller's version is stale. 409. */
  static dealVersionConflict(
    message = "This deal was modified. Reload and retry.",
  ): AppError {
    return new AppError({
      statusCode: 409,
      code: "DEAL_VERSION_CONFLICT",
      message,
    });
  }

  /** An idempotency key was reused with a materially different request. 409. */
  static idempotencyConflict(message: string): AppError {
    return new AppError({
      statusCode: 409,
      code: "DEAL_IDEMPOTENCY_CONFLICT",
      message,
    });
  }

  /** A monetary amount failed validation (precision, sign, magnitude). 400. */
  static invalidMoneyAmount(message: string): AppError {
    return new AppError({
      statusCode: 400,
      code: "INVALID_MONEY_AMOUNT",
      message,
    });
  }

  /** A currency code is not in the supported ISO 4217 catalog. 400. */
  static invalidCurrency(message: string): AppError {
    return new AppError({
      statusCode: 400,
      code: "INVALID_CURRENCY",
      message,
    });
  }

  /** A deadline/date-time invariant was violated. 400. */
  static invalidDeadline(message: string): AppError {
    return new AppError({
      statusCode: 400,
      code: "INVALID_DEADLINE",
      message,
    });
  }

  // -------------------------------------------------------------------------
  // Counterparties & negotiation (Phase 5)
  // -------------------------------------------------------------------------

  /** A counterparty relationship does not exist or is not visible. 404. */
  static counterpartyNotFound(
    message = "Counterparty relationship not found.",
  ): AppError {
    return new AppError({
      statusCode: 404,
      code: "COUNTERPARTY_NOT_FOUND",
      message,
    });
  }

  /** An organization cannot be its own counterparty. 400. */
  static counterpartySelf(
    message = "An organization cannot be its own counterparty.",
  ): AppError {
    return new AppError({
      statusCode: 400,
      code: "COUNTERPARTY_SELF",
      message,
    });
  }

  /** The two organizations are already in a counterparty relationship. 409. */
  static counterpartyExists(
    message = "This counterparty relationship already exists.",
  ): AppError {
    return new AppError({
      statusCode: 409,
      code: "COUNTERPARTY_ALREADY_EXISTS",
      message,
    });
  }

  /** The requested counterparty status/verification move is illegal. 409. */
  static counterpartyInvalidTransition(message: string): AppError {
    return new AppError({
      statusCode: 409,
      code: "COUNTERPARTY_INVALID_TRANSITION",
      message,
    });
  }

  /** Deal-scoped resources collapse to a generic not-found: the caller is not
   *  an (ACTIVE) participant, or the id is not theirs to see. 404. Safe to
   *  return for both genuinely-missing and unauthorized deals/offers. */
  static dealParticipantNotFound(message = "Deal not found."): AppError {
    return new AppError({
      statusCode: 404,
      code: "DEAL_PARTICIPANT_NOT_FOUND",
      message,
    });
  }

  /** The viewer's participant row exists but is not ACTIVE. 403. */
  static dealParticipantNotActive(message: string): AppError {
    return new AppError({
      statusCode: 403,
      code: "DEAL_PARTICIPANT_NOT_ACTIVE",
      message,
    });
  }

  /** The organization is already a participant of this deal. 409. */
  static dealParticipantExists(
    message = "This organization is already a participant of the deal.",
  ): AppError {
    return new AppError({
      statusCode: 409,
      code: "DEAL_PARTICIPANT_ALREADY_EXISTS",
      message,
    });
  }

  /** The OWNER participant cannot be suspended/removed or have its type changed. 409. */
  static dealParticipantOwnerImmutable(message: string): AppError {
    return new AppError({
      statusCode: 409,
      code: "DEAL_PARTICIPANT_OWNER_IMMUTABLE",
      message,
    });
  }

  /** Optimistic-concurrency guard on a participant status change. 409. */
  static dealParticipantVersionConflict(
    message = "This participant was modified. Reload and retry.",
  ): AppError {
    return new AppError({
      statusCode: 409,
      code: "DEAL_PARTICIPANT_VERSION_CONFLICT",
      message,
    });
  }

  /** A participant transition requestId was reused for a different change. 409. */
  static dealParticipantIdempotencyConflict(message: string): AppError {
    return new AppError({
      statusCode: 409,
      code: "DEAL_PARTICIPANT_IDEMPOTENCY_CONFLICT",
      message,
    });
  }

  /** The deal-invitation token is expired. 410. */
  static dealInvitationExpired(
    message = "This invitation has expired.",
  ): AppError {
    return new AppError({
      statusCode: 410,
      code: "DEAL_INVITATION_EXPIRED",
      message,
    });
  }

  /** The deal-invitation token was revoked. 409. */
  static dealInvitationRevoked(
    message = "This invitation has been revoked.",
  ): AppError {
    return new AppError({
      statusCode: 409,
      code: "DEAL_INVITATION_REVOKED",
      message,
    });
  }

  /** The deal-invitation token was already accepted or declined. 409. */
  static dealInvitationAlreadyUsed(
    message = "This invitation has already been used.",
  ): AppError {
    return new AppError({
      statusCode: 409,
      code: "DEAL_INVITATION_ALREADY_USED",
      message,
    });
  }

  /** An offer does not exist or is not visible to the caller. 404. */
  static offerNotFound(message = "Offer not found."): AppError {
    return new AppError({
      statusCode: 404,
      code: "OFFER_NOT_FOUND",
      message,
    });
  }

  /** The offer's current state blocks the operation. 409. */
  static offerInvalidState(message: string): AppError {
    return new AppError({
      statusCode: 409,
      code: "OFFER_INVALID_STATE",
      message,
    });
  }

  /** The state machine forbids the requested offer move. 409. */
  static offerInvalidTransition(message: string): AppError {
    return new AppError({
      statusCode: 409,
      code: "OFFER_INVALID_TRANSITION",
      message,
    });
  }

  /** An offer/deal window has passed. 409. */
  static offerExpired(message = "This offer has expired."): AppError {
    return new AppError({
      statusCode: 409,
      code: "OFFER_EXPIRED",
      message,
    });
  }

  /** A concurrent actor changed the offer; the caller's version is stale. 409. */
  static offerConcurrencyConflict(
    message = "This offer was modified. Reload and retry.",
  ): AppError {
    return new AppError({
      statusCode: 409,
      code: "OFFER_CONCURRENCY_CONFLICT",
      message,
    });
  }

  /** An offer idempotency key/requestId was reused for a different request. 409. */
  static offerIdempotencyConflict(message: string): AppError {
    return new AppError({
      statusCode: 409,
      code: "OFFER_IDEMPOTENCY_CONFLICT",
      message,
    });
  }

  /** The chosen offer recipient cannot receive offers. 400. */
  static offerRecipientInvalid(message: string): AppError {
    return new AppError({
      statusCode: 400,
      code: "OFFER_RECIPIENT_INVALID",
      message,
    });
  }

  // -------------------------------------------------------------------------
  // Documents & deal requirements (Phase 6)
  // -------------------------------------------------------------------------

  /** A document does not exist or is not visible to the caller. 404. Safe to
   *  return for both genuinely-missing ids and ids outside the visibility
   *  window so cross-tenant ids can never be probed. */
  static documentNotFound(message = "Document not found."): AppError {
    return new AppError({
      statusCode: 404,
      code: "DOCUMENT_NOT_FOUND",
      message,
    });
  }

  /** A document exists but the caller has no visibility grant (PRIVATE or a
   *  window that excludes them). Never distinguished from DOCUMENT_NOT_FOUND
   *  on the wire by default — use only internally (e.g. download). 404. */
  static documentNotVisible(message = "Document not found."): AppError {
    return new AppError({
      statusCode: 404,
      code: "DOCUMENT_NOT_VISIBLE",
      message,
    });
  }

  /** The caller raises a document permission the visibility model forbids. 403. */
  static documentAccessDenied(
    message = "You are not allowed to access this document.",
    details?: unknown,
  ): AppError {
    return new AppError({
      statusCode: 403,
      code: "DOCUMENT_ACCESS_DENIED",
      message,
      details,
    });
  }

  /** The document's current status blocks the requested upload/lifecycle step. 409. */
  static documentInvalidState(message: string): AppError {
    return new AppError({
      statusCode: 409,
      code: "DOCUMENT_INVALID_STATE",
      message,
    });
  }

  /** The document state machine forbids the requested move. 409. */
  static documentInvalidTransition(message: string): AppError {
    return new AppError({
      statusCode: 409,
      code: "DOCUMENT_INVALID_TRANSITION",
      message,
    });
  }

  /** A document was already submitted for review. 409. */
  static documentAlreadySubmitted(
    message = "This document has already been submitted for review.",
  ): AppError {
    return new AppError({
      statusCode: 409,
      code: "DOCUMENT_ALREADY_SUBMITTED",
      message,
    });
  }

  /** A document/review window passed. 409. */
  static documentExpired(
    message = "This document's upload or review window has passed.",
  ): AppError {
    return new AppError({
      statusCode: 409,
      code: "DOCUMENT_EXPIRED",
      message,
    });
  }

  /** A concurrent actor moved the document; the caller's snapshot is stale. 409. */
  static documentVersionConflict(
    message = "This document was modified. Reload and retry.",
  ): AppError {
    return new AppError({
      statusCode: 409,
      code: "DOCUMENT_VERSION_CONFLICT",
      message,
    });
  }

  /** The uploaded bytes failed validation (size, signature, filename). 400. */
  static documentUploadInvalid(message: string): AppError {
    return new AppError({
      statusCode: 400,
      code: "DOCUMENT_UPLOAD_INVALID",
      message,
    });
  }

  /** The upload exceeds the configured per-document size cap. 413. */
  static documentTooLarge(
    message = "The document is too large. Upload failed.",
  ): AppError {
    return new AppError({
      statusCode: 413,
      code: "DOCUMENT_TOO_LARGE",
      message,
    });
  }

  /** The requested document type/filename/extension is not permitted. 400. */
  static documentTypeNotAllowed(message: string): AppError {
    return new AppError({
      statusCode: 400,
      code: "DOCUMENT_TYPE_NOT_ALLOWED",
      message,
    });
  }

  /** The document is not in a state that satisfies the requested operation. 409. */
  static documentNotReady(message: string): AppError {
    return new AppError({
      statusCode: 409,
      code: "DOCUMENT_NOT_READY",
      message,
    });
  }

  /** The document storage layer failed (object missing, IO error). 500. */
  static documentStorageError(
    message = "The document storage layer could not complete the operation.",
    cause?: unknown,
  ): AppError {
    return new AppError({
      statusCode: 500,
      code: "DOCUMENT_STORAGE_ERROR",
      message,
      expose: false,
      cause,
    });
  }

  /** A requirement does not exist or is not visible to the caller. 404. */
  static requirementNotFound(message = "Requirement not found."): AppError {
    return new AppError({
      statusCode: 404,
      code: "REQUIREMENT_NOT_FOUND",
      message,
    });
  }

  /** A requirement exists but the caller has no visibility grant. 404. */
  static requirementNotVisible(message = "Requirement not found."): AppError {
    return new AppError({
      statusCode: 404,
      code: "REQUIREMENT_NOT_VISIBLE",
      message,
    });
  }

  /** The requirement's current status blocks the requested operation. 409. */
  static requirementInvalidState(message: string): AppError {
    return new AppError({
      statusCode: 409,
      code: "REQUIREMENT_INVALID_STATE",
      message,
    });
  }

  /** The requirement state machine forbids the requested move. 409. */
  static requirementInvalidTransition(message: string): AppError {
    return new AppError({
      statusCode: 409,
      code: "REQUIREMENT_INVALID_TRANSITION",
      message,
    });
  }

  /** The caller's organization is not the assigned submitter. 403. */
  static requirementNotAssigned(message: string): AppError {
    return new AppError({
      statusCode: 403,
      code: "REQUIREMENT_NOT_ASSIGNED",
      message,
    });
  }

  /** Raising an already-raised satisfaction request would double-count. 409. */
  static requirementAlreadySatisfied(
    message = "This requirement is already satisfied.",
  ): AppError {
    return new AppError({
      statusCode: 409,
      code: "REQUIREMENT_ALREADY_SATISFIED",
      message,
    });
  }

  /** A requirement operation referenced an invalid/insufficient document. 400. */
  static requirementDocumentInvalid(message: string): AppError {
    return new AppError({
      statusCode: 400,
      code: "REQUIREMENT_DOCUMENT_INVALID",
      message,
    });
  }

  /** The requirement/documents are not ready to satisfy the operation. 409. */
  static requirementNotReady(message: string): AppError {
    return new AppError({
      statusCode: 409,
      code: "REQUIREMENT_NOT_READY",
      message,
    });
  }

  // -------------------------------------------------------------------------
  // Approval Engine (Phase 7)
  // -------------------------------------------------------------------------

  static approvalPolicyNotFound(message = "Approval policy not found."): AppError {
    return new AppError({
      statusCode: 404,
      code: "APPROVAL_POLICY_NOT_FOUND",
      message,
    });
  }

  static approvalPolicyInactive(message = "This approval policy is not active."): AppError {
    return new AppError({
      statusCode: 409,
      code: "APPROVAL_POLICY_INACTIVE",
      message,
    });
  }

  static approvalPolicyConflict(message = "Approval policy conflict."): AppError {
    return new AppError({
      statusCode: 409,
      code: "APPROVAL_POLICY_CONFLICT",
      message,
    });
  }

  static approvalWorkflowNotFound(message = "Approval workflow not found."): AppError {
    return new AppError({
      statusCode: 404,
      code: "APPROVAL_WORKFLOW_NOT_FOUND",
      message,
    });
  }

  static approvalWorkflowAlreadyActive(message = "An approval workflow is already active for this deal."): AppError {
    return new AppError({
      statusCode: 409,
      code: "APPROVAL_WORKFLOW_ALREADY_ACTIVE",
      message,
    });
  }

  static approvalWorkflowInvalidState(message = "This approval workflow is in an invalid state."): AppError {
    return new AppError({
      statusCode: 409,
      code: "APPROVAL_WORKFLOW_INVALID_STATE",
      message,
    });
  }

  static approvalRequestNotFound(message = "Approval request not found."): AppError {
    return new AppError({
      statusCode: 404,
      code: "APPROVAL_REQUEST_NOT_FOUND",
      message,
    });
  }

  static approvalRequestNotAssigned(message = "This approval request is not assigned to you."): AppError {
    return new AppError({
      statusCode: 403,
      code: "APPROVAL_REQUEST_NOT_ASSIGNED",
      message,
    });
  }

  static approvalRequestInvalidState(message = "This approval request is in an invalid state."): AppError {
    return new AppError({
      statusCode: 409,
      code: "APPROVAL_REQUEST_INVALID_STATE",
      message,
    });
  }

  static approvalNotAuthorized(message = "You are not authorized to perform this approval."): AppError {
    return new AppError({
      statusCode: 403,
      code: "APPROVAL_NOT_AUTHORIZED",
      message,
    });
  }

  static approvalRequirementsIncomplete(message = "Deal requirements are not complete."): AppError {
    return new AppError({
      statusCode: 409,
      code: "APPROVAL_REQUIREMENTS_INCOMPLETE",
      message,
    });
  }

  static approvalSodViolation(message = "This approval violates segregation of duties."): AppError {
    return new AppError({
      statusCode: 403,
      code: "APPROVAL_SOD_VIOLATION",
      message,
    });
  }

  static approvalSequenceBlocked(message = "This approval request is not yet eligible for decision."): AppError {
    return new AppError({
      statusCode: 409,
      code: "APPROVAL_SEQUENCE_BLOCKED",
      message,
    });
  }

  static approvalApproverAlreadyAssigned(
    message = "That user is already an approver on this workflow.",
  ): AppError {
    return new AppError({
      statusCode: 409,
      code: "APPROVAL_APPROVER_ALREADY_ASSIGNED",
      message,
    });
  }

  static approvalExpired(message = "This approval has expired."): AppError {
    return new AppError({
      statusCode: 409,
      code: "APPROVAL_EXPIRED",
      message,
    });
  }

  static approvalAlreadyDecided(message = "This approval request has already been decided."): AppError {
    return new AppError({
      statusCode: 409,
      code: "APPROVAL_ALREADY_DECIDED",
      message,
    });
  }

  static approvalConcurrencyConflict(message = "This approval was modified concurrently. Reload and retry."): AppError {
    return new AppError({
      statusCode: 409,
      code: "APPROVAL_CONCURRENCY_CONFLICT",
      message,
    });
  }

  static approvalReapprovalRequired(message = "A material change requires a new approval cycle."): AppError {
    return new AppError({
      statusCode: 409,
      code: "APPROVAL_REAPPROVAL_REQUIRED",
      message,
    });
  }

  static approvalPolicyEvaluationFailed(message = "Failed to evaluate approval policy."): AppError {
    return new AppError({
      statusCode: 400,
      code: "APPROVAL_POLICY_EVALUATION_FAILED",
      message,
    });
  }

  // Settlement & Reconciliation (Phase 8)
  static settlementNotReady(message = "Deal is not ready for settlement."): AppError {
    return new AppError({
      statusCode: 409,
      code: "SETTLEMENT_NOT_READY",
      message,
    });
  }

  static settlementAlreadyActive(message = "A settlement is already active for this deal."): AppError {
    return new AppError({
      statusCode: 409,
      code: "SETTLEMENT_ALREADY_ACTIVE",
      message,
    });
  }

  static settlementAlreadyCompleted(message = "This deal has already been settled."): AppError {
    return new AppError({
      statusCode: 409,
      code: "SETTLEMENT_ALREADY_COMPLETED",
      message,
    });
  }

  static settlementNotFound(message = "Settlement not found."): AppError {
    return new AppError({
      statusCode: 404,
      code: "SETTLEMENT_NOT_FOUND",
      message,
    });
  }

  static settlementNotAuthorized(message = "You are not authorized to access this settlement."): AppError {
    return new AppError({
      statusCode: 403,
      code: "SETTLEMENT_NOT_AUTHORIZED",
      message,
    });
  }

  static settlementProviderUnavailable(message = "Settlement provider is unavailable."): AppError {
    return new AppError({
      statusCode: 503,
      code: "SETTLEMENT_PROVIDER_UNAVAILABLE",
      message,
    });
  }

  static settlementProviderError(message = "Settlement provider returned an error."): AppError {
    return new AppError({
      statusCode: 502,
      code: "SETTLEMENT_PROVIDER_ERROR",
      message,
    });
  }

  static settlementIdempotencyConflict(message = "This idempotency key was already used for a different settlement."): AppError {
    return new AppError({
      statusCode: 409,
      code: "SETTLEMENT_IDEMPOTENCY_CONFLICT",
      message,
    });
  }

  static settlementConcurrencyConflict(message = "This settlement was modified concurrently. Reload and retry."): AppError {
    return new AppError({
      statusCode: 409,
      code: "SETTLEMENT_CONCURRENCY_CONFLICT",
      message,
    });
  }

  static settlementStateConflict(message = "Settlement state conflict."): AppError {
    return new AppError({
      statusCode: 409,
      code: "SETTLEMENT_STATE_CONFLICT",
      message,
    });
  }

  static settlementReferenceConflict(message = "A settlement with this provider reference already exists."): AppError {
    return new AppError({
      statusCode: 409,
      code: "SETTLEMENT_REFERENCE_CONFLICT",
      message,
    });
  }

  static reconciliationNotFound(message = "Reconciliation not found."): AppError {
    return new AppError({
      statusCode: 404,
      code: "RECONCILIATION_NOT_FOUND",
      message,
    });
  }

  static reconciliationMismatch(message = "Reconciliation mismatch detected."): AppError {
    return new AppError({
      statusCode: 409,
      code: "RECONCILIATION_MISMATCH",
      message,
    });
  }

  static reconciliationNotAuthorized(message = "You are not authorized to access this reconciliation."): AppError {
    return new AppError({
      statusCode: 403,
      code: "RECONCILIATION_NOT_AUTHORIZED",
      message,
    });
  }

  static reconciliationAlreadyResolved(message = "This reconciliation has already been resolved."): AppError {
    return new AppError({
      statusCode: 409,
      code: "RECONCILIATION_ALREADY_RESOLVED",
      message,
    });
  }

  static reconciliationStateConflict(message = "Reconciliation state conflict."): AppError {
    return new AppError({
      statusCode: 409,
      code: "RECONCILIATION_STATE_CONFLICT",
      message,
    });
  }

  // Deal Intelligence (Phase 9)

  /** The AI/ML service could not be reached (connection refused, 5xx proxy). 503. */
  static aiServiceUnavailable(
    message = "The intelligence service is unavailable.",
    cause?: unknown,
  ): AppError {
    return new AppError({
      statusCode: 503,
      code: "AI_SERVICE_UNAVAILABLE",
      message,
      expose: false,
      cause,
    });
  }

  /** The AI/ML service did not answer within the configured timeout. 504. */
  static aiServiceTimeout(
    message = "The intelligence service timed out.",
    cause?: unknown,
  ): AppError {
    return new AppError({
      statusCode: 504,
      code: "AI_SERVICE_TIMEOUT",
      message,
      expose: false,
      cause,
    });
  }

  /** The AI/ML service rejected the backend's credentials. 502. */
  static aiServiceUnauthorized(
    message = "The intelligence service rejected the request.",
    cause?: unknown,
  ): AppError {
    return new AppError({
      statusCode: 502,
      code: "AI_SERVICE_UNAUTHORIZED",
      message,
      cause,
    });
  }

  /** The AI/ML service responded with data that failed strict validation. 502. */
  static aiInvalidResponse(
    message = "The intelligence service returned an invalid response.",
    cause?: unknown,
  ): AppError {
    return new AppError({
      statusCode: 502,
      code: "AI_INVALID_RESPONSE",
      message,
      expose: false,
      cause,
    });
  }

  /** The upstream analysis pipeline failed. 502. */
  static aiAnalysisFailed(
    message = "Deal analysis failed.",
    cause?: unknown,
  ): AppError {
    return new AppError({
      statusCode: 502,
      code: "AI_ANALYSIS_FAILED",
      message,
      expose: false,
      cause,
    });
  }

  /** The assembled context exceeded the AI/ML service's size cap. 413. */
  static aiInputTooLarge(
    message = "The deal context is too large for the intelligence service.",
  ): AppError {
    return new AppError({
      statusCode: 413,
      code: "AI_INPUT_TOO_LARGE",
      message,
    });
  }

  /** The question falls outside the deal context and cannot be answered. 422. */
  static aiQueryOutOfScope(
    message = "The question is outside this deal's context.",
  ): AppError {
    return new AppError({
      statusCode: 422,
      code: "AI_QUERY_OUT_OF_SCOPE",
      message,
    });
  }

  /** The intelligence service throttled or rate-limited the backend. 429. */
  static aiRateLimited(
    message = "The intelligence service is rate-limiting requests.",
  ): AppError {
    return new AppError({
      statusCode: 429,
      code: "AI_RATE_LIMITED",
      message,
    });
  }

  /** A stored intelligence run does not exist or is not visible. 404. */
  static aiAnalysisNotFound(message = "Intelligence analysis not found."): AppError {
    return new AppError({
      statusCode: 404,
      code: "AI_ANALYSIS_NOT_FOUND",
      message,
    });
  }

  /** The caller is not permitted to trigger intelligence on this deal. 403. */
  static aiNotAuthorized(
    message = "You are not authorized to use deal intelligence.",
  ): AppError {
    return new AppError({
      statusCode: 403,
      code: "AI_NOT_AUTHORIZED",
      message,
    });
  }

  // Quantum Optimization (Phase 10)

  /** The quantum service could not be reached (connection refused, 5xx). 503. */
  static quantumServiceUnavailable(
    message = "The quantum optimization service is unavailable.",
    cause?: unknown,
  ): AppError {
    return new AppError({
      statusCode: 503,
      code: "QUANTUM_SERVICE_UNAVAILABLE",
      message,
      expose: false,
      cause,
    });
  }

  /** The quantum service did not answer within the configured timeout. 504. */
  static quantumServiceTimeout(
    message = "The quantum optimization service timed out.",
    cause?: unknown,
  ): AppError {
    return new AppError({
      statusCode: 504,
      code: "QUANTUM_SERVICE_TIMEOUT",
      message,
      expose: false,
      cause,
    });
  }

  /** The quantum service rejected the backend's credentials. 502. */
  static quantumServiceUnauthorized(
    message = "The quantum optimization service rejected the request.",
    cause?: unknown,
  ): AppError {
    return new AppError({
      statusCode: 502,
      code: "QUANTUM_SERVICE_UNAUTHORIZED",
      message,
      cause,
    });
  }

  /** The quantum service responded with data that failed strict validation. 502. */
  static quantumInvalidResponse(
    message = "The quantum optimization service returned an invalid response.",
    cause?: unknown,
  ): AppError {
    return new AppError({
      statusCode: 502,
      code: "QUANTUM_INVALID_RESPONSE",
      message,
      expose: false,
      cause,
    });
  }

  /** The upstream optimization pipeline failed. 502. */
  static quantumOptimizationFailed(
    message = "Route optimization failed.",
    cause?: unknown,
  ): AppError {
    return new AppError({
      statusCode: 502,
      code: "QUANTUM_OPTIMIZATION_FAILED",
      message,
      expose: false,
      cause,
    });
  }

  /** The assembled problem exceeded the quantum service's size cap. 413. */
  static quantumInputTooLarge(
    message = "The optimization problem is too large for the quantum service.",
  ): AppError {
    return new AppError({
      statusCode: 413,
      code: "QUANTUM_INPUT_TOO_LARGE",
      message,
    });
  }

  /** The quantum service rejected the assembled problem as infeasible. 422. */
  static quantumProblemRejected(
    message = "The optimization problem was rejected by the quantum service.",
    cause?: unknown,
  ): AppError {
    return new AppError({
      statusCode: 422,
      code: "QUANTUM_PROBLEM_REJECTED",
      message,
      expose: false,
      cause,
    });
  }

  /** A stored optimization run does not exist or is not visible. 404. */
  static quantumOptimizationNotFound(
    message = "Optimization run not found.",
  ): AppError {
    return new AppError({
      statusCode: 404,
      code: "QUANTUM_OPTIMIZATION_NOT_FOUND",
      message,
    });
  }

  /** The caller is not permitted to run optimizations on this deal. 403. */
  static quantumNotAuthorized(
    message = "You are not authorized to run route optimizations.",
  ): AppError {
    return new AppError({
      statusCode: 403,
      code: "QUANTUM_NOT_AUTHORIZED",
      message,
    });
  }
}

/**
 * Stable error codes mapped onto their canonical messages. Unexpected errors
 * are logged internally but reported to clients in generic terms.
 */
export const INTERNAL_SERVER_ERROR_MESSAGE = "An unexpected error occurred.";
