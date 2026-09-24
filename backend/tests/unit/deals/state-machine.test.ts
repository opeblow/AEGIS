import { describe, expect, it } from "vitest";
import {
  DEAL_STATUSES,
  DEAL_TYPES,
  isDeadlineExpirable,
  isLegalTransition,
  isTerminalStatus,
  requireLegalTransition,
  transitionReasonOf,
  transitionTypeFor,
} from "../../../src/modules/deals/deal-state.js";
import { AppError } from "../../../src/lib/errors/index.js";

const TERMINAL = ["COMPLETED", "EXPIRED", "CANCELLED", "FAILED", "DISPUTED"];

describe("deal state machine", () => {
  it("declares the full status and type catalogs", () => {
    expect(DEAL_STATUSES).toContain("DRAFT");
    expect(DEAL_STATUSES).toContain("COMPLETED");
    expect(DEAL_TYPES).toContain("OTHER");
    expect(new Set(DEAL_STATUSES).size).toBe(DEAL_STATUSES.length);
  });

  it("permits every forward edge of the happy path", () => {
    const happy: Array<[string, string]> = [
      ["DRAFT", "OPEN"],
      ["OPEN", "NEGOTIATING"],
      ["NEGOTIATING", "AGREED"],
      ["AGREED", "APPROVAL_PENDING"],
      ["APPROVAL_PENDING", "APPROVED"],
      ["APPROVED", "SETTLEMENT_PENDING"],
      ["SETTLEMENT_PENDING", "SETTLED"],
      ["SETTLED", "RECONCILING"],
      ["RECONCILING", "COMPLETED"],
    ];
    for (const [from, to] of happy) {
      expect(isLegalTransition(from, to)).toBe(true);
    }
  });

  it("permits escape hatches from every non-terminal state", () => {
    const expirable: Array<[string, string]> = [
      ["DRAFT", "EXPIRED"],
      ["OPEN", "EXPIRED"],
      ["NEGOTIATING", "EXPIRED"],
      ["AGREED", "EXPIRED"],
      ["APPROVED", "EXPIRED"],
    ];
    for (const [from, to] of expirable) {
      expect(isLegalTransition(from, to)).toBe(true);
    }

    expect(isLegalTransition("DRAFT", "CANCELLED")).toBe(true);
    expect(isLegalTransition("SETTLEMENT_PENDING", "FAILED")).toBe(true);
    expect(isLegalTransition("SETTLED", "DISPUTED")).toBe(true);
  });

  it("forbids illegal, self-, and reverse moves", () => {
    const illegal: Array<[string, string]> = [
      ["OPEN", "DRAFT"],
      ["DRAFT", "NEGOTIATING"],
      ["DRAFT", "COMPLETED"],
      ["NEGOTIATING", "OPEN"],
      ["DRAFT", "DRAFT"],
      ["OPEN", "OPEN"],
      ["COMPLETED", "DISPUTED"],
      ["CANCELLED", "OPEN"],
      ["EXPIRED", "COMPLETED"],
      ["FAILED", "SETTLED"],
      ["DISPUTED", "RECONCILING"],
    ];
    for (const [from, to] of illegal) {
      expect(isLegalTransition(from, to)).toBe(false);
    }
  });

  it("treats only terminal states as terminal", () => {
    for (const status of DEAL_STATUSES) {
      const terminal = TERMINAL.includes(status);
      if (terminal) {
        expect(isTerminalStatus(status)).toBe(true);
        // No edge leaves a terminal state.
        for (const candidate of DEAL_STATUSES) {
          expect(isLegalTransition(status, candidate)).toBe(false);
        }
      } else {
        expect(isTerminalStatus(status)).toBe(false);
      }
    }
  });

  it("exposes the deadline-expiry check only for states with an EXPIRED edge", () => {
    for (const status of DEAL_STATUSES) {
      expect(isDeadlineExpirable(status)).toBe(
        isLegalTransition(status, "EXPIRED"),
      );
    }
    expect(isDeadlineExpirable("DRAFT")).toBe(true);
    expect(isDeadlineExpirable("APPROVAL_PENDING")).toBe(false);
    expect(isDeadlineExpirable("SETTLED")).toBe(false);
    expect(isDeadlineExpirable("COMPLETED")).toBe(false);
  });

  it("requireLegalTransition throws INVALID_DEAL_TRANSITION-style validation for illegal moves", () => {
    expect(() => requireLegalTransition("OPEN", "DRAFT")).toThrow(AppError);
    expect(() => requireLegalTransition("OPEN", "NEGOTIATING")).not.toThrow();
  });

  it("maps statuses to transition types and canned reasons", () => {
    expect(transitionTypeFor("OPEN")).toBe("DEAL_OPENED");
    expect(transitionTypeFor("CANCELLED")).toBe("DEAL_CANCELLED");
    expect(transitionTypeFor("COMPLETED")).toBe("DEAL_COMPLETED");
    expect(transitionReasonOf("DEAL_OPENED")).toBe(
      "Deal opened to the counterparty.",
    );
    expect(transitionReasonOf("DEAL_CANCELLED")).toBe("Deal cancelled.");
  });
});
