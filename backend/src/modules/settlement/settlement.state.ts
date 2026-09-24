import { AppError } from "../../lib/errors/index.js";

export type SettlementStatus =
  | "CREATED"
  | "SUBMITTING"
  | "SUBMITTED"
  | "PENDING"
  | "SETTLED"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED";

export const SETTLEMENT_STATUSES = [
  "CREATED",
  "SUBMITTING",
  "SUBMITTED",
  "PENDING",
  "SETTLED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
] as const satisfies readonly SettlementStatus[];

const NO_EDGE: ReadonlySet<SettlementStatus> = new Set();
const TERMINAL: ReadonlySet<SettlementStatus> = new Set([
  "SETTLED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
]);

const TRANSITIONS: ReadonlyMap<SettlementStatus, ReadonlySet<SettlementStatus>> = new Map([
  ["CREATED", new Set(["SUBMITTING", "CANCELLED", "EXPIRED"])],
  ["SUBMITTING", new Set(["SUBMITTED", "FAILED", "CANCELLED"])],
  ["SUBMITTED", new Set(["PENDING", "FAILED", "CANCELLED"])],
  ["PENDING", new Set(["SETTLED", "FAILED", "CANCELLED"])],
  ["SETTLED", NO_EDGE],
  ["FAILED", NO_EDGE],
  ["CANCELLED", NO_EDGE],
  ["EXPIRED", NO_EDGE],
]);

export function isTerminalSettlementStatus(status: SettlementStatus): boolean {
  return TERMINAL.has(status);
}

export function isLegalSettlementTransition(
  from: SettlementStatus,
  to: SettlementStatus,
): boolean {
  if (from === to) return false;
  const allowed = TRANSITIONS.get(from);
  return allowed !== undefined && allowed.has(to);
}

export function settlementTransitionReasonOf(transitionType: string): string {
  switch (transitionType) {
    case "SETTLEMENT_SUBMITTING":
      return "Settlement submitted to provider.";
    case "SETTLEMENT_SUBMITTED":
      return "Provider acknowledged submission.";
    case "SETTLEMENT_PENDING":
      return "Settlement pending confirmation.";
    case "SETTLEMENT_SETTLED":
      return "Settlement completed successfully.";
    case "SETTLEMENT_FAILED":
      return "Settlement failed.";
    case "SETTLEMENT_CANCELLED":
      return "Settlement cancelled.";
    case "SETTLEMENT_EXPIRED":
      return "Settlement expired.";
    default:
      return "Settlement state changed.";
  }
}

export function settlementTransitionTypeFor(status: SettlementStatus): string {
  switch (status) {
    case "SUBMITTING":
      return "SETTLEMENT_SUBMITTING";
    case "SUBMITTED":
      return "SETTLEMENT_SUBMITTED";
    case "PENDING":
      return "SETTLEMENT_PENDING";
    case "SETTLED":
      return "SETTLEMENT_SETTLED";
    case "FAILED":
      return "SETTLEMENT_FAILED";
    case "CANCELLED":
      return "SETTLEMENT_CANCELLED";
    case "EXPIRED":
      return "SETTLEMENT_EXPIRED";
    default:
      return "SETTLEMENT_CREATED";
  }
}

export function requireLegalSettlementTransition(
  from: SettlementStatus,
  to: SettlementStatus,
): void {
  if (!isLegalSettlementTransition(from, to)) {
    throw AppError.validation(
      `Invalid settlement transition: ${from} -> ${to} is not permitted.`,
    );
  }
}