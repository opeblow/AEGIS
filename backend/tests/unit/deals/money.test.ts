import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import type { Deal, DealStateTransition } from "@prisma/client";
import {
  assertMoneyForCurrency,
  currencyInfo,
  isKnownCurrency,
  isZeroMoney,
  moneyFractionDigits,
} from "../../../src/modules/deals/deal.schemas.js";
import { AppError } from "../../../src/lib/errors/index.js";

describe("ISO 4217 money policy", () => {
  it("recognizes supported and rejects unknown currencies", () => {
    for (const code of ["USD", "EUR", "GBP", "JPY", "NGN", "KES", "XAF"]) {
      expect(isKnownCurrency(code)).toBe(true);
    }
    for (const code of ["USDT", "usd", "NIS", "", "US"]) {
      expect(isKnownCurrency(code)).toBe(false);
    }
    expect(() => currencyInfo("USD")).not.toThrow();
    expect(() => currencyInfo("USDT")).toThrow(AppError);
    expect(() => currencyInfo("USDT")).toThrow(/currency/i);
  });

  it("derives per-currency minor-unit precision", () => {
    expect(currencyInfo("USD").minor).toBe(2);
    expect(currencyInfo("JPY").minor).toBe(0);
    expect(currencyInfo("XOF").minor).toBe(0);
  });

  it("measures fractional digits on money strings", () => {
    expect(moneyFractionDigits("1000")).toBe(0);
    expect(moneyFractionDigits("1000.5")).toBe(1);
    expect(moneyFractionDigits("0.00000001")).toBe(8);
  });

  it("detects zero money", () => {
    expect(isZeroMoney("0")).toBe(true);
    expect(isZeroMoney("0.000")).toBe(true);
    expect(isZeroMoney("00.00")).toBe(true);
    expect(isZeroMoney("0.1")).toBe(false);
    expect(isZeroMoney("100")).toBe(false);
  });

  it("accepts valid positive amounts within currency precision", () => {
    expect(() => assertMoneyForCurrency("1250000.50", "USD")).not.toThrow();
    expect(() => assertMoneyForCurrency("1000", "USD")).not.toThrow();
    expect(() => assertMoneyForCurrency("90000000", "JPY")).not.toThrow();
    expect(() => assertMoneyForCurrency("0.01", "KES")).not.toThrow();
    expect(() => assertMoneyForCurrency("100", "XOF")).not.toThrow();
  });

  it("rejects zero amounts", () => {
    expect(() => assertMoneyForCurrency("0", "USD")).toThrow(AppError);
    expect(() => assertMoneyForCurrency("0.00", "USD")).toThrow(
      /greater than zero/i,
    );
  });

  it("rejects malformed money syntax", () => {
    for (const bad of [
      "-50",
      "1.5e6",
      "abc",
      "",
      "1,000.50",
      "NaN",
      "1.2.3",
      "--",
    ]) {
      expect(() => assertMoneyForCurrency(bad, "USD")).toThrow(AppError);
    }
  });

  it("rejects precision beyond the currency's minor units (reject, don't round)", () => {
    expect(() => assertMoneyForCurrency("1.234", "USD")).toThrow(
      /2 decimal places/i,
    );
    expect(() => assertMoneyForCurrency("1000.5", "JPY")).toThrow(
      /0 decimal places/i,
    );
    expect(() => assertMoneyForCurrency("0.00000009", "USD")).toThrow(
      /2 decimal places/i,
    );
  });

  it("rejects precision beyond the 8-digit DECIMAL(28,8) column", () => {
    expect(() => assertMoneyForCurrency("1.123456789", "KES")).toThrow(
      AppError,
    );
  });
});

describe("deal wire serialization", () => {
  const base = {
    id: "a".repeat(36),
    organizationId: "b".repeat(36),
    createdByUserId: "c".repeat(36),
    reference: "AEG-2026-000001",
    type: "RWA_PURCHASE",
    status: "DRAFT",
    name: "Test",
    description: null,
    currency: "USD",
    notionalAmount: new Prisma.Decimal("1234.56"),
    settledAmount: null as Prisma.Decimal | null,
    settlementDate: null as Date | null,
    expiresAt: new Date("2026-12-01T00:00:00.000Z"),
    metadata: null,
    version: 2,
    createdAt: new Date("2026-09-01T10:00:00.000Z"),
    updatedAt: new Date("2026-09-02T10:00:00.000Z"),
  };

  it("serializes money as precision-preserving strings and dates as ISO 8601", async () => {
    const { toPublicDeal } =
      await import("../../../src/modules/deals/deal.types.js");
    const wire = toPublicDeal(base as Deal);
    expect(wire.notionalAmount).toBe("1234.56");
    expect(wire.settledAmount).toBeNull();
    expect(wire.settlementDate).toBeNull();
    expect(wire.expiresAt).toBe("2026-12-01T00:00:00.000Z");
    expect(wire.createdAt).toBe("2026-09-01T10:00:00.000Z");
    expect(wire.version).toBe(2);
  });

  it("serializes transitions with nullable actor and requestId", async () => {
    const { toPublicDealTransition } =
      await import("../../../src/modules/deals/deal.types.js");
    const wire = toPublicDealTransition({
      id: "d".repeat(36),
      dealId: "a".repeat(36),
      organizationId: "b".repeat(36),
      requestId: null,
      transitionType: "DEAL_EXPIRED",
      fromStatus: "DRAFT",
      toStatus: "EXPIRED",
      reason: "System expiry.",
      actorUserId: null,
      createdAt: new Date("2026-09-03T00:00:00.000Z"),
    } as DealStateTransition);
    expect(wire.actorUserId).toBeNull();
    expect(wire.requestId).toBeNull();
    expect(wire.toStatus).toBe("EXPIRED");
    expect(wire.createdAt).toBe("2026-09-03T00:00:00.000Z");
  });
});
