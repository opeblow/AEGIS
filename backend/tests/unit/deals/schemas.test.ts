import { describe, expect, it } from "vitest";
import {
  createDealBodySchema,
  dealHistoryQuerySchema,
  dealQuerySchema,
  dealReferenceField,
  dealUuidParamsSchema,
  transitionDealBodySchema,
  updateDealBodySchema,
} from "../../../src/modules/deals/deal.schemas.js";

const VALID_UUID = "11111111-2222-4333-8444-555555555555";

function validCreate(): Record<string, unknown> {
  return {
    type: "RWA_PURCHASE",
    name: "Warehouse acquisition",
    description: "Industrial asset in the eastern corridor.",
    currency: "USD",
    notionalAmount: "2500000.75",
    settlementDate: "2026-12-01T00:00:00.000Z",
    expiresAt: "2026-11-01T00:00:00.000Z",
    reference: "ACME-001",
    metadata: { sector: "industrial", paperwork: true },
    idempotencyKey: "create-key-12345",
  };
}

describe("deal schemas", () => {
  describe("createDealBodySchema", () => {
    it("accepts a complete valid body", () => {
      const parsed = createDealBodySchema.safeParse(validCreate());
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        const body = parsed.data;
        expect(body.type).toBe("RWA_PURCHASE");
        expect(body.notionalAmount).toBe("2500000.75");
        expect(body.version).toBeUndefined();
        expect(body.status).toBeUndefined();
      }
    });

    it("accepts a minimal body and applies no defaults", () => {
      const parsed = createDealBodySchema.safeParse({
        type: "OTHER",
        name: "Minimal",
        currency: "JPY",
        notionalAmount: "1000",
      });
      expect(parsed.success).toBe(true);
    });

    it("rejects missing required fields", () => {
      const requiredFields = [
        "type",
        "name",
        "currency",
        "notionalAmount",
      ] as const;
      for (const field of requiredFields) {
        const body = validCreate();
        delete body[field];
        const parsed = createDealBodySchema.safeParse(body);
        expect(parsed.success, `expected ${field} to be required`).toBe(false);
      }
    });

    it("rejects unknown keys and status writes", () => {
      expect(
        createDealBodySchema.safeParse({ ...validCreate(), status: "OPEN" })
          .success,
      ).toBe(false);
      expect(
        createDealBodySchema.safeParse({
          ...validCreate(),
          organizationId: VALID_UUID,
        }).success,
      ).toBe(false);
    });

    it("rejects bad money, bad currency, and contradictory deadlines", () => {
      const badMoney = [
        { currency: "USDT" },
        { notionalAmount: "0" },
        { notionalAmount: "-5" },
        { notionalAmount: "1.234" },
        { notionalAmount: 1234.5 },
        { currency: "JPY", notionalAmount: "100.5" },
        { currency: "NGN", notionalAmount: "1.999" },
      ];
      for (const patch of badMoney) {
        const parsed = createDealBodySchema.safeParse({
          ...validCreate(),
          ...patch,
        });
        expect(
          parsed.success,
          `expected ${JSON.stringify(patch)} to fail`,
        ).toBe(false);
      }

      const badDeadlines = [
        { expiresAt: "2000-01-01T00:00:00.000Z" },
        {
          settlementDate: "2026-12-01T00:00:00.000Z",
          expiresAt: "2026-12-01T00:00:01.000Z",
        },
        { settlementDate: "not a date" },
      ];
      for (const patch of badDeadlines) {
        const parsed = createDealBodySchema.safeParse({
          ...validCreate(),
          ...patch,
        });
        expect(
          parsed.success,
          `expected ${JSON.stringify(patch)} to fail`,
        ).toBe(false);
      }
    });

    it("rejects too-short idempotency keys and oversized metadata", () => {
      expect(
        createDealBodySchema.safeParse({
          ...validCreate(),
          idempotencyKey: "short",
        }).success,
      ).toBe(false);
      const hugeMetadata: Record<string, unknown> = {};
      for (let i = 0; i < 51; i++) hugeMetadata[`k${i}`] = i;
      expect(
        createDealBodySchema.safeParse({
          ...validCreate(),
          metadata: hugeMetadata,
        }).success,
      ).toBe(false);
    });
  });

  describe("updateDealBodySchema", () => {
    it("requires version and forbids status", () => {
      expect(
        updateDealBodySchema.safeParse({ version: 1, name: "Renamed" }).success,
      ).toBe(true);
      expect(
        updateDealBodySchema.safeParse({ name: "No version" }).success,
      ).toBe(false);
      expect(
        updateDealBodySchema.safeParse({ version: 0, name: "Zero" }).success,
      ).toBe(false);
      expect(
        updateDealBodySchema.safeParse({ version: 1, status: "OPEN" }).success,
      ).toBe(false);
    });

    it("validates currency + notional as a pair when both change", () => {
      expect(
        updateDealBodySchema.safeParse({
          version: 1,
          currency: "NGN",
          notionalAmount: "1.99",
        }).success,
      ).toBe(true);
      expect(
        updateDealBodySchema.safeParse({
          version: 1,
          currency: "NGN",
          notionalAmount: "1.999",
        }).success,
      ).toBe(false);
    });

    it("allows clearing nullable fields", () => {
      expect(
        updateDealBodySchema.safeParse({
          version: 1,
          description: null,
          expiresAt: null,
          settlementDate: null,
        }).success,
      ).toBe(true);
    });
  });

  describe("transitionDealBodySchema", () => {
    it("requires requestId, version, and a valid toStatus", () => {
      expect(
        transitionDealBodySchema.safeParse({
          toStatus: "OPEN",
          version: 1,
          requestId: "request-1234",
        }).success,
      ).toBe(true);
      expect(
        transitionDealBodySchema.safeParse({ toStatus: "OPEN", version: 1 })
          .success,
      ).toBe(false);
      expect(
        transitionDealBodySchema.safeParse({
          toStatus: "OPEN",
          requestId: "request-1234",
        }).success,
      ).toBe(false);
      expect(
        transitionDealBodySchema.safeParse({
          toStatus: "SOMEDAY",
          version: 1,
          requestId: "request-1234",
        }).success,
      ).toBe(false);
    });

    it("requires a reason for significant outbound moves", () => {
      for (const to of ["CANCELLED", "EXPIRED", "FAILED", "DISPUTED"]) {
        expect(
          transitionDealBodySchema.safeParse({
            toStatus: to,
            version: 1,
            requestId: "request-1234",
          }).success,
          `expected reason required for ${to}`,
        ).toBe(false);
        expect(
          transitionDealBodySchema.safeParse({
            toStatus: to,
            version: 1,
            requestId: "request-1234",
            reason: "Counterparty unreachable.",
          }).success,
        ).toBe(true);
      }
    });
  });

  describe("query and param schemas", () => {
    it("applies list defaults for empty queries", () => {
      const parsed = dealQuerySchema.safeParse({});
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.page).toBe(1);
        expect(parsed.data.limit).toBe(20);
        expect(parsed.data.sort).toBe("createdAt");
        expect(parsed.data.order).toBe("desc");
      }
    });

    it("rejects invalid pagination, unknown keys, and inverted date ranges", () => {
      expect(dealQuerySchema.safeParse({ page: 0 }).success).toBe(false);
      expect(dealQuerySchema.safeParse({ limit: 51 }).success).toBe(false);
      expect(dealQuerySchema.safeParse({ sort: "id" }).success).toBe(false);
      expect(dealQuerySchema.safeParse({ admin_query: 1 }).success).toBe(false);
      expect(
        dealQuerySchema.safeParse({
          createdFrom: "2026-10-01T00:00:00.000Z",
          createdTo: "2026-09-01T00:00:00.000Z",
        }).success,
      ).toBe(false);
    });

    it("bounds history pagination", () => {
      expect(dealHistoryQuerySchema.safeParse({}).success).toBe(true);
      const parsed = dealHistoryQuerySchema.safeParse({});
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.limit).toBe(50);
        expect(parsed.data.offset).toBe(0);
      }
      expect(dealHistoryQuerySchema.safeParse({ limit: 101 }).success).toBe(
        false,
      );
      expect(dealHistoryQuerySchema.safeParse({ offset: -1 }).success).toBe(
        false,
      );
    });

    it("requires real UUID params", () => {
      expect(
        dealUuidParamsSchema.safeParse({
          organizationId: VALID_UUID,
          dealId: VALID_UUID,
        }).success,
      ).toBe(true);
      expect(
        dealUuidParamsSchema.safeParse({
          organizationId: "nope",
          dealId: VALID_UUID,
        }).success,
      ).toBe(false);
      expect(
        dealUuidParamsSchema.safeParse({ organizationId: VALID_UUID }).success,
      ).toBe(false);
    });

    it("validates client reference format", () => {
      expect(dealReferenceField.safeParse("ACME-2026_01").success).toBe(true);
      expect(dealReferenceField.safeParse("-bad").success).toBe(false);
      expect(dealReferenceField.safeParse("with space").success).toBe(false);
    });
  });
});
