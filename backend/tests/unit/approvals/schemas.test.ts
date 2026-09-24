import { describe, expect, it } from "vitest";
import {
  createPolicyBodySchema,
  decideRequestBodySchema,
  dealUuidParamsSchema,
  policyListQuerySchema,
  policyUuidParamsSchema,
  requestUuidParamsSchema,
  startWorkflowBodySchema,
  updatePolicyBodySchema,
  validateAllRules,
  validateRuleConfig,
  workflowListQuerySchema,
  workflowUuidParamsSchema,
  requestListQuerySchema,
} from "../../../src/modules/approvals/approval.schemas.js";

const UUID = "11111111-2222-4333-8444-555555555555";

describe("approval schemas", () => {
  describe("createPolicyBodySchema", () => {
    it("accepts valid policy with rules", () => {
      const body = {
        name: "High Value Approval",
        description: "For large deals",
        rules: [
          { ruleType: "NOTIONAL_THRESHOLD", config: { threshold: "100000", comparator: ">=", roles: ["CFO"] } },
        ],
      };
      const parsed = createPolicyBodySchema.safeParse(body);
      expect(parsed.success).toBe(true);
    });

    it("rejects missing name", () => {
      expect(
        createPolicyBodySchema.safeParse({
          rules: [{ ruleType: "ROLE_APPROVAL", config: { roles: ["CFO"] } }],
        }).success,
      ).toBe(false);
    });

    it("rejects empty rules array", () => {
      expect(
        createPolicyBodySchema.safeParse({ name: "Test", rules: [] }).success,
      ).toBe(false);
    });

    it("rejects missing rules", () => {
      expect(
        createPolicyBodySchema.safeParse({ name: "Test" }).success,
      ).toBe(false);
    });
  });

  describe("updatePolicyBodySchema", () => {
    it("accepts partial updates", () => {
      expect(
        updatePolicyBodySchema.safeParse({ name: "Updated" }).success,
      ).toBe(true);
    });

    it("accepts rules update", () => {
      expect(
        updatePolicyBodySchema.safeParse({
          rules: [{ ruleType: "DEAL_TYPE", config: { types: ["RWA_PURCHASE"], roles: ["CFO"] } }],
        }).success,
      ).toBe(true);
    });

    it("accepts empty rules array on update", () => {
      expect(
        updatePolicyBodySchema.safeParse({ rules: [] }).success,
      ).toBe(true);
    });
  });

  describe("startWorkflowBodySchema", () => {
    it("accepts valid start", () => {
      expect(
        startWorkflowBodySchema.safeParse({ policyId: UUID }).success,
      ).toBe(true);
    });

    it("accepts expiresInMinutes", () => {
      expect(
        startWorkflowBodySchema.safeParse({
          policyId: UUID,
          expiresInMinutes: 60,
        }).success,
      ).toBe(true);
    });

    it("rejects non-uuid policyId", () => {
      expect(
        startWorkflowBodySchema.safeParse({ policyId: "bad" }).success,
      ).toBe(false);
    });

    it("rejects excessive expiresInMinutes", () => {
      expect(
        startWorkflowBodySchema.safeParse({
          policyId: UUID,
          expiresInMinutes: 10081,
        }).success,
      ).toBe(false);
    });
  });

  describe("decideRequestBodySchema", () => {
    it("accepts APPROVE", () => {
      expect(
        decideRequestBodySchema.safeParse({ action: "APPROVE" }).success,
      ).toBe(true);
    });

    it("accepts REJECT", () => {
      expect(
        decideRequestBodySchema.safeParse({ action: "REJECT" }).success,
      ).toBe(true);
    });

    it("rejects invalid action", () => {
      expect(
        decideRequestBodySchema.safeParse({ action: "APPROVED" }).success,
      ).toBe(false);
    });
  });

  describe("param schemas", () => {
    it("validates UUID params", () => {
      expect(
        policyUuidParamsSchema.safeParse({
          organizationId: UUID,
          policyId: UUID,
        }).success,
      ).toBe(true);
      expect(
        policyUuidParamsSchema.safeParse({
          organizationId: "bad",
          policyId: UUID,
        }).success,
      ).toBe(false);
      expect(
        policyUuidParamsSchema.safeParse({ organizationId: UUID }).success,
      ).toBe(false);
    });

    it("validates deal UUID params", () => {
      expect(
        dealUuidParamsSchema.safeParse({
          organizationId: UUID,
          dealId: UUID,
        }).success,
      ).toBe(true);
    });

    it("validates workflow UUID params", () => {
      expect(
        workflowUuidParamsSchema.safeParse({
          organizationId: UUID,
          workflowId: UUID,
        }).success,
      ).toBe(true);
    });

    it("validates request UUID params", () => {
      expect(
        requestUuidParamsSchema.safeParse({
          organizationId: UUID,
          requestId: UUID,
        }).success,
      ).toBe(true);
    });
  });

  describe("list query schemas", () => {
    it("applies defaults for policies", () => {
      const parsed = policyListQuerySchema.safeParse({});
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.page).toBe(1);
        expect(parsed.data.limit).toBe(20);
      }
    });

    it("validates policy status enum", () => {
      expect(
        policyListQuerySchema.safeParse({ status: "DRAFT" }).success,
      ).toBe(true);
      expect(
        policyListQuerySchema.safeParse({ status: "INVALID" }).success,
      ).toBe(false);
    });

    it("applies defaults for workflows", () => {
      const parsed = workflowListQuerySchema.safeParse({});
      expect(parsed.success).toBe(true);
    });

    it("validates workflow status enum", () => {
      expect(
        workflowListQuerySchema.safeParse({
          status: "PENDING",
        }).success,
      ).toBe(true);
      expect(
        workflowListQuerySchema.safeParse({
          status: "INVALID",
        }).success,
      ).toBe(false);
    });

    it("applies defaults for requests", () => {
      const parsed = requestListQuerySchema.safeParse({});
      expect(parsed.success).toBe(true);
    });

    it("validates request status enum", () => {
      expect(
        requestListQuerySchema.safeParse({ status: "PENDING" }).success,
      ).toBe(true);
      expect(
        requestListQuerySchema.safeParse({ status: "INVALID" }).success,
      ).toBe(false);
    });
  });
});

describe("validateAllRules", () => {
  it("accepts valid rules", () => {
    expect(() =>
      validateAllRules([
        { ruleType: "ROLE_APPROVAL", config: { roles: ["CFO"] } },
        { ruleType: "NOTIONAL_THRESHOLD", config: { threshold: "100", comparator: ">=", roles: ["CFO"] } },
      ]),
    ).not.toThrow();
  });

  it("rejects missing ruleType", () => {
    expect(() =>
      validateAllRules([{ config: {} } as never]),
    ).toThrow("missing ruleType");
  });

  it("rejects missing config", () => {
    expect(() =>
      validateAllRules([{ ruleType: "ROLE_APPROVAL" } as never]),
    ).toThrow("missing config");
  });

  it("rejects invalid NOTIONAL_THRESHOLD config", () => {
    expect(() =>
      validateAllRules([{ ruleType: "NOTIONAL_THRESHOLD", config: {} } as never]),
    ).toThrow("NOTIONAL_THRESHOLD requires threshold");
  });
});

describe("validateRuleConfig", () => {
  it("throws on unknown rule type", () => {
    expect(() =>
      validateRuleConfig("UNKNOWN" as never, {}),
    ).toThrow("Unknown rule type: UNKNOWN");
  });
});
