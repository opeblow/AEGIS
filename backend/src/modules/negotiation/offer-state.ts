import { AppError } from "../../lib/errors/index.js";

// ---------------------------------------------------------------------------
// Offer state machine (Phase 5)
//
// A single source of truth for how offers move. Statuses never change through
// a free-form write — every move appends an OfferTransition row and goes
// through the conditional status+version update in offer.service.ts.
//
//   DRAFT      -> SUBMITTED, WITHDRAWN
//   SUBMITTED  -> COUNTERED (a child counteroffer was created), ACCEPTED,
//                 REJECTED, WITHDRAWN, EXPIRED
//   COUNTERED  -> SUBMITTED (the counteroffer was rejected -> parent is live
//                 again), SUPERSEDED (the counteroffer was accepted),
//                 EXPIRED
//   ACCEPTED / REJECTED / WITHDRAWN / EXPIRED / SUPERSEDED: terminal.
//
// Counters are born already SUBMITTED (a counter is an active, live response
// — there is no draft stage at the far end of a chain). This mirrors the
// example flow: Offer -> Counteroffer -> Counteroffer -> Accepted.
// ---------------------------------------------------------------------------

export type OfferStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "COUNTERED"
  | "ACCEPTED"
  | "REJECTED"
  | "WITHDRAWN"
  | "EXPIRED"
  | "SUPERSEDED";

export const OFFER_STATUSES: readonly OfferStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "COUNTERED",
  "ACCEPTED",
  "REJECTED",
  "WITHDRAWN",
  "EXPIRED",
  "SUPERSEDED",
];

const NO_EDGE: ReadonlySet<OfferStatus> = new Set();

const OFFER_TRANSITIONS: Readonly<
  Record<OfferStatus, ReadonlySet<OfferStatus>>
> = {
  DRAFT: new Set(["SUBMITTED", "WITHDRAWN"]),
  SUBMITTED: new Set([
    "COUNTERED",
    "ACCEPTED",
    "REJECTED",
    "WITHDRAWN",
    "EXPIRED",
  ]),
  COUNTERED: new Set(["SUBMITTED", "SUPERSEDED", "EXPIRED"]),
  ACCEPTED: NO_EDGE,
  REJECTED: NO_EDGE,
  WITHDRAWN: NO_EDGE,
  EXPIRED: NO_EDGE,
  SUPERSEDED: NO_EDGE,
};

export const OFFER_TERMINAL_STATUSES: ReadonlySet<OfferStatus> = new Set([
  "ACCEPTED",
  "REJECTED",
  "WITHDRAWN",
  "EXPIRED",
  "SUPERSEDED",
]);

export function isOfferTerminal(status: OfferStatus): boolean {
  return OFFER_TERMINAL_STATUSES.has(status);
}

/** Whether an offer may move `from -> to` under the state machine. */
export function isOfferLegalTransition(
  from: OfferStatus,
  to: OfferStatus,
): boolean {
  if (from === to) return false;
  const allowed = OFFER_TRANSITIONS[from];
  return allowed !== undefined && allowed.has(to);
}

export function requireOfferLegalTransition(
  from: OfferStatus,
  to: OfferStatus,
): void {
  if (!isOfferLegalTransition(from, to)) {
    throw AppError.offerInvalidTransition(
      `Invalid offer transition: ${from} -> ${to} is not permitted.`,
    );
  }
}

/** Wire event label for the transition target (mirrors deal-state naming). */
export function offerTransitionTypeFor(to: OfferStatus): string {
  switch (to) {
    case "SUBMITTED":
      return "OFFER_SUBMITTED";
    case "COUNTERED":
      return "OFFER_COUNTERED";
    case "ACCEPTED":
      return "OFFER_ACCEPTED";
    case "REJECTED":
      return "OFFER_REJECTED";
    case "WITHDRAWN":
      return "OFFER_WITHDRAWN";
    case "EXPIRED":
      return "OFFER_EXPIRED";
    case "SUPERSEDED":
      return "OFFER_SUPERSEDED";
    default:
      return "OFFER_CREATED";
  }
}

export function offerReasonOf(transitionType: string): string {
  switch (transitionType) {
    case "OFFER_CREATED":
      return "Offer drafted.";
    case "OFFER_SUBMITTED":
      return "Offer submitted.";
    case "OFFER_COUNTERED":
      return "Counteroffer submitted.";
    case "OFFER_ACCEPTED":
      return "Offer accepted.";
    case "OFFER_REJECTED":
      return "Offer rejected.";
    case "OFFER_WITHDRAWN":
      return "Offer withdrawn.";
    case "OFFER_EXPIRED":
      return "Offer expired.";
    case "OFFER_SUPERSEDED":
      return "Offer superseded by an accepted counteroffer.";
    default:
      return "Offer status changed.";
  }
}

// ---------------------------------------------------------------------------
// DealParticipant state machine (Phase 5)
// ---------------------------------------------------------------------------

export type DealParticipantStatus =
  "INVITED" | "ACTIVE" | "DECLINED" | "REMOVED" | "SUSPENDED";

export const DEAL_PARTICIPANT_STATUSES: readonly DealParticipantStatus[] = [
  "INVITED",
  "ACTIVE",
  "DECLINED",
  "REMOVED",
  "SUSPENDED",
];

const PARTICIPANT_TRANSITIONS: Readonly<
  Record<DealParticipantStatus, ReadonlySet<DealParticipantStatus>>
> = {
  INVITED: new Set(["ACTIVE", "DECLINED", "REMOVED"]),
  ACTIVE: new Set(["SUSPENDED", "REMOVED"]),
  SUSPENDED: new Set(["ACTIVE", "REMOVED"]),
  DECLINED: new Set<DealParticipantStatus>(),
  REMOVED: new Set<DealParticipantStatus>(),
};

export function isParticipantTransitionLegal(
  from: DealParticipantStatus,
  to: DealParticipantStatus,
): boolean {
  if (from === to) return false;
  const allowed = PARTICIPANT_TRANSITIONS[from];
  return allowed !== undefined && allowed.has(to);
}

export function participantTransitionTypeFor(
  to: DealParticipantStatus,
): string {
  switch (to) {
    case "ACTIVE":
      return "PARTICIPANT_JOINED";
    case "DECLINED":
      return "PARTICIPANT_DECLINED";
    case "REMOVED":
      return "PARTICIPANT_REMOVED";
    case "SUSPENDED":
      return "PARTICIPANT_SUSPENDED";
    default:
      return "PARTICIPANT_INVITED";
  }
}

export function participantReasonOf(to: DealParticipantStatus): string {
  switch (to) {
    case "ACTIVE":
      return "Participant accepted the invitation.";
    case "DECLINED":
      return "Participant declined the invitation.";
    case "REMOVED":
      return "Participant removed by the deal owner.";
    case "SUSPENDED":
      return "Participant suspended by the deal owner.";
    default:
      return "Participant invitation sent.";
  }
}
