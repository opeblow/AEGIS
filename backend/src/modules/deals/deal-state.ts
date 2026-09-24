import { AppError } from "../../lib/errors/index.js";

/**
 * A deal's lifecycle is a real state machine, never a free-form status string
 * that an endpoint can set arbitrarily. Every legal-commercial transition is
 * declared here as an explicit, human-auditable edge in the transition table.
 *
 * The state machine is the SINGLE source of truth for which moves are legal
 * and which requester capability each move needs. Route/service code consults
 * this table and never hardcodes its own notion of "can I move to X".
 *
 * Rules that hold for every edge in this table:
 *   - Transitions are appended to `DealStateTransition` (immutable history).
 *   - A deal's `status` column is a denormalized projection of the latest
 *     transition and is only ever changed by one atomic service call that also
 *     writes the history row.
 *   - Terminal statuses are truly terminal: once a deal is COMPLETED, EXPIRED,
 *     CANCELLED, FAILED or DISPUTED, no edge leaves it.
 */

export type DealStatus =
  | "DRAFT"
  | "OPEN"
  | "NEGOTIATING"
  | "AGREED"
  | "APPROVAL_PENDING"
  | "APPROVED"
  | "SETTLEMENT_PENDING"
  | "SETTLED"
  | "RECONCILING"
  | "COMPLETED"
  | "EXPIRED"
  | "CANCELLED"
  | "FAILED"
  | "DISPUTED";

/** Deal classification, mirrored byte-for-byte from the Prisma `DealType` enum. */
export type DealType = "RWA_PURCHASE" | "RWA_SALE" | "PRIVATE_TRADE" | "OTHER";

export const DEAL_TYPES = [
  "RWA_PURCHASE",
  "RWA_SALE",
  "PRIVATE_TRADE",
  "OTHER",
] as const satisfies readonly DealType[];

export const DEAL_STATUSES = [
  "DRAFT",
  "OPEN",
  "NEGOTIATING",
  "AGREED",
  "APPROVAL_PENDING",
  "APPROVED",
  "SETTLEMENT_PENDING",
  "SETTLED",
  "RECONCILING",
  "COMPLETED",
  "EXPIRED",
  "CANCELLED",
  "FAILED",
  "DISPUTED",
] as const;

const NO_EDGE: ReadonlySet<DealStatus> = new Set();
const TERMINAL: ReadonlySet<DealStatus> = new Set([
  "COMPLETED",
  "EXPIRED",
  "CANCELLED",
  "FAILED",
  "DISPUTED",
]);

/**
 * Authoritative transition table: from-status -> set of legal to-statuses.
 * No status may transition to itself (a no-op move is rejected, not silently
 * accepted) and no terminal status has incoming-outgoing edges.
 *
 * Forward flow: DRAFT -> OPEN -> NEGOTIATING -> AGREED -> APPROVAL_PENDING ->
 * APPROVED -> SETTLEMENT_PENDING -> SETTLED -> RECONCILING -> COMPLETED.
 * Ways out at every non-terminal state: EXPIRED (deadline), CANCELLED
 * (parties walked away / admin decision), DISPUTED (from post-settlement),
 * FAILED (hard non-retryable failure during a pending state).
 */
const TRANSITIONS: ReadonlyMap<DealStatus, ReadonlySet<DealStatus>> = new Map([
  ["DRAFT", new Set(["OPEN", "EXPIRED", "CANCELLED"])],
  ["OPEN", new Set(["NEGOTIATING", "EXPIRED", "CANCELLED"])],
  ["NEGOTIATING", new Set(["AGREED", "EXPIRED", "CANCELLED"])],
  ["AGREED", new Set(["APPROVAL_PENDING", "EXPIRED", "CANCELLED"])],
  ["APPROVAL_PENDING", new Set(["APPROVED", "CANCELLED", "FAILED"])],
  ["APPROVED", new Set(["SETTLEMENT_PENDING", "CANCELLED", "EXPIRED"])],
  ["SETTLEMENT_PENDING", new Set(["SETTLED", "FAILED", "CANCELLED"])],
  ["SETTLED", new Set(["RECONCILING", "DISPUTED"])],
  ["RECONCILING", new Set(["COMPLETED", "DISPUTED"])],
  ["COMPLETED", NO_EDGE],
  ["EXPIRED", NO_EDGE],
  ["CANCELLED", NO_EDGE],
  ["FAILED", NO_EDGE],
  ["DISPUTED", NO_EDGE],
]);

export function isTerminalStatus(status: DealStatus): boolean {
  return TERMINAL.has(status);
}

export function isLegalTransition(from: DealStatus, to: DealStatus): boolean {
  if (from === to) return false;
  const allowed = TRANSITIONS.get(from);
  return allowed !== undefined && allowed.has(to);
}

/**
 * Whether `status` can be left via the EXPIRED edge. Drives the deadline
 * expiry worker: only statuses that the state machine explicitly allows to
 * expire are candidates — the worker never invents a transition.
 */
export function isDeadlineExpirable(status: DealStatus): boolean {
  return isLegalTransition(status, "EXPIRED");
}

export function transitionReasonOf(transitionType: string): string {
  switch (transitionType) {
    case "DEAL_CREATED":
      return "Deal created.";
    case "DEAL_OPENED":
      return "Deal opened to the counterparty.";
    case "DEAL_NEGOTIATING":
      return "Negotiations started.";
    case "DEAL_AGREED":
      return "Both parties agreed on commercial terms.";
    case "DEAL_APPROVAL_PENDING":
      return "Submitted for approval.";
    case "DEAL_APPROVED":
      return "Approved by the organization.";
    case "DEAL_SETTLEMENT_PENDING":
      return "Settlement initiated.";
    case "DEAL_SETTLED":
      return "Settlement completed.";
    case "DEAL_RECONCILING":
      return "Reconciliation started.";
    case "DEAL_COMPLETED":
      return "Deal completed.";
    case "DEAL_EXPIRED":
      return "Deal expired before completion.";
    case "DEAL_CANCELLED":
      return "Deal cancelled.";
    case "DEAL_FAILED":
      return "Deal failed.";
    case "DEAL_DISPUTED":
      return "Deal disputed.";
    default:
      return "Deal state changed.";
  }
}

/**
 * Lower-level helper used by the service to build validation/transition calls
 * for the audit/pipeline events. Centralizes the mapping so neither routes nor
 * services scatter raw status literals.
 */
export function transitionTypeFor(status: DealStatus): string {
  switch (status) {
    case "OPEN":
      return "DEAL_OPENED";
    case "NEGOTIATING":
      return "DEAL_NEGOTIATING";
    case "AGREED":
      return "DEAL_AGREED";
    case "APPROVAL_PENDING":
      return "DEAL_APPROVAL_PENDING";
    case "APPROVED":
      return "DEAL_APPROVED";
    case "SETTLEMENT_PENDING":
      return "DEAL_SETTLEMENT_PENDING";
    case "SETTLED":
      return "DEAL_SETTLED";
    case "RECONCILING":
      return "DEAL_RECONCILING";
    case "COMPLETED":
      return "DEAL_COMPLETED";
    case "EXPIRED":
      return "DEAL_EXPIRED";
    case "CANCELLED":
      return "DEAL_CANCELLED";
    case "FAILED":
      return "DEAL_FAILED";
    case "DISPUTED":
      return "DEAL_DISPUTED";
    default:
      return "DEAL_CREATED";
  }
}

/** Guard used before applying a user-initiated transition. */
export function requireLegalTransition(from: DealStatus, to: DealStatus): void {
  if (!isLegalTransition(from, to)) {
    throw AppError.validation(
      `Invalid deal transition: ${from} -> ${to} is not permitted.`,
    );
  }
}
