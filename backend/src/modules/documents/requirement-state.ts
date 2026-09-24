import { AppError } from "../../lib/errors/index.js";
import type { RequirementStatus as PrismaRequirementStatus } from "@prisma/client";

// ---------------------------------------------------------------------------
// Requirement state machine (Phase 6)
//
//   OPEN       -> SUBMITTED (assigned org), WAIVED (owner), EXPIRED (worker)
//   SUBMITTED  -> SATISFIED (owner), REJECTED (owner), EXPIRED (worker)
//   REJECTED   -> OPEN (owner)
//   SATISFIED / WAIVED / EXPIRED: terminal.
//
// Submissions come from the assigned organization (or the owner when no
// organization is assigned); every owner-side verdict (reject/waive/satisfy)
// appends a DealRequirementTransition row behind a conditional status update.
// ---------------------------------------------------------------------------

export type RequirementStatus = PrismaRequirementStatus;

export const REQUIREMENT_STATUSES: readonly RequirementStatus[] = [
  "OPEN",
  "SUBMITTED",
  "SATISFIED",
  "REJECTED",
  "WAIVED",
  "EXPIRED",
];

const NO_EDGE: ReadonlySet<RequirementStatus> = new Set();

const REQUIREMENT_TRANSITIONS: Readonly<
  Record<RequirementStatus, ReadonlySet<RequirementStatus>>
> = {
  OPEN: new Set(["SUBMITTED", "WAIVED", "EXPIRED"]),
  SUBMITTED: new Set(["SATISFIED", "REJECTED", "EXPIRED"]),
  REJECTED: new Set(["OPEN"]),
  SATISFIED: NO_EDGE,
  WAIVED: NO_EDGE,
  EXPIRED: NO_EDGE,
};

/** Statuses the worker lazily expires when `dueAt` passes. */
export const REQUIREMENT_EXPIRABLE_STATUSES: readonly RequirementStatus[] = [
  "OPEN",
  "SUBMITTED",
];

export function isRequirementLegalTransition(
  from: RequirementStatus,
  to: RequirementStatus,
): boolean {
  if (from === to) return false;
  const allowed = REQUIREMENT_TRANSITIONS[from];
  return allowed !== undefined && allowed.has(to);
}

export function requireRequirementLegalTransition(
  from: RequirementStatus,
  to: RequirementStatus,
): void {
  if (!isRequirementLegalTransition(from, to)) {
    throw AppError.requirementInvalidTransition(
      `Invalid requirement transition: ${from} -> ${to} is not permitted.`,
    );
  }
}

/** Wire event label for the transition target. */
export function requirementTransitionTypeFor(to: RequirementStatus): string {
  switch (to) {
    case "SUBMITTED":
      return "REQUIREMENT_SUBMITTED";
    case "SATISFIED":
      return "REQUIREMENT_SATISFIED";
    case "REJECTED":
      return "REQUIREMENT_REJECTED";
    case "WAIVED":
      return "REQUIREMENT_WAIVED";
    case "EXPIRED":
      return "REQUIREMENT_EXPIRED";
    default:
      return "REQUIREMENT_OPEN";
  }
}

export function requirementReasonOf(transitionType: string): string {
  switch (transitionType) {
    case "REQUIREMENT_OPEN":
      return "Requirement created.";
    case "REQUIREMENT_SUBMITTED":
      return "Requirement submitted by the assigned organization.";
    case "REQUIREMENT_SATISFIED":
      return "Requirement satisfied by the deal owner.";
    case "REQUIREMENT_REJECTED":
      return "Requirement submission rejected by the deal owner.";
    case "REQUIREMENT_WAIVED":
      return "Requirement waived by the deal owner.";
    case "REQUIREMENT_EXPIRED":
      return "Requirement deadline passed.";
    default:
      return "Requirement status changed.";
  }
}
