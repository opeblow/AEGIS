import { describe, expect, it } from "vitest";
import { evaluatePolicy, evaluateRule } from "../../../src/modules/approvals/approval-policy.evaluator.js";
import type { ApprovalAssignment } from "../../../src/modules/approvals/approval.types.js";

function makeRoleUsers(map: Record<string, string[]>): Map<string, string[]> {
  return new Map(Object.entries(map));
}

function makeSeq(): () => number {
  let n = 0;
  return () => n++;
}

const deal = {
  type: "RWA_PURCHASE" as const,
  currency: "USD" as const,
  notionalAmount: "500000.00",
};

type _MockDb = {
  organizationMember: {
    findMany: ReturnType<typeof import("@prisma/client").PrismaClient.organizationMember.findMany>;
  };
};

describe("evaluateRule", () => {
  describe("ROLE_APPROVAL", () => {
    it("assigns all users in specified roles", () => {
      const roleUsers = makeRoleUsers({ CFO: ["u1"], COO: ["u2"] });
      const result = evaluateRule(
        "ROLE_APPROVAL",
        { roles: ["CFO", "COO"] },
        deal,
        roleUsers,
        makeSeq(),
      );
      expect(result).toHaveLength(2);
      expect(result.map((a) => a.userId).sort()).toEqual(["u1", "u2"]);
    });

    it("assigns required=true and sequential order", () => {
      const roleUsers = makeRoleUsers({ CFO: ["u1"] });
      const result = evaluateRule(
        "ROLE_APPROVAL",
        { roles: ["CFO"] },
        deal,
        roleUsers,
        makeSeq(),
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ sequence: 0, required: true });
    });

    it("returns empty for unknown role", () => {
      const roleUsers = makeRoleUsers({ CFO: ["u1"] });
      const result = evaluateRule(
        "ROLE_APPROVAL",
        { roles: ["CEO"] },
        deal,
        roleUsers,
        makeSeq(),
      );
      expect(result).toHaveLength(0);
    });
  });

  describe("NOTIONAL_THRESHOLD", () => {
    it("assigns when amount >= threshold", () => {
      const roleUsers = makeRoleUsers({ CFO: ["u1"] });
      const result = evaluateRule(
        "NOTIONAL_THRESHOLD",
        { threshold: "100000", comparator: ">=", roles: ["CFO"] },
        deal,
        roleUsers,
        makeSeq(),
      );
      expect(result).toHaveLength(1);
    });

    it("assigns when amount = threshold", () => {
      const roleUsers = makeRoleUsers({ CFO: ["u1"] });
      const result = evaluateRule(
        "NOTIONAL_THRESHOLD",
        { threshold: "500000", comparator: "=", roles: ["CFO"] },
        deal,
        roleUsers,
        makeSeq(),
      );
      expect(result).toHaveLength(1);
    });

    it("assigns when amount <= threshold", () => {
      const roleUsers = makeRoleUsers({ CFO: ["u1"] });
      const result = evaluateRule(
        "NOTIONAL_THRESHOLD",
        { threshold: "500000", comparator: "<=", roles: ["CFO"] },
        deal,
        roleUsers,
        makeSeq(),
      );
      expect(result).toHaveLength(1);
    });

    it("rejects when below threshold", () => {
      const roleUsers = makeRoleUsers({ CFO: ["u1"] });
      const result = evaluateRule(
        "NOTIONAL_THRESHOLD",
        { threshold: "1000000", comparator: ">=", roles: ["CFO"] },
        deal,
        roleUsers,
        makeSeq(),
      );
      expect(result).toHaveLength(0);
    });
  });

  describe("DEAL_TYPE", () => {
    it("assigns when deal type matches", () => {
      const roleUsers = makeRoleUsers({ CFO: ["u1"] });
      const result = evaluateRule(
        "DEAL_TYPE",
        { types: ["RWA_PURCHASE"], roles: ["CFO"] },
        deal,
        roleUsers,
        makeSeq(),
      );
      expect(result).toHaveLength(1);
    });

    it("rejects when deal type does not match", () => {
      const roleUsers = makeRoleUsers({ CFO: ["u1"] });
      const result = evaluateRule(
        "DEAL_TYPE",
        { types: ["PRIVATE_TRADE"], roles: ["CFO"] },
        deal,
        roleUsers,
        makeSeq(),
      );
      expect(result).toHaveLength(0);
    });
  });

  describe("CURRENCY", () => {
    it("assigns when currency matches", () => {
      const roleUsers = makeRoleUsers({ CFO: ["u1"] });
      const result = evaluateRule(
        "CURRENCY",
        { currencies: ["USD"], roles: ["CFO"] },
        deal,
        roleUsers,
        makeSeq(),
      );
      expect(result).toHaveLength(1);
    });

    it("rejects when currency does not match", () => {
      const roleUsers = makeRoleUsers({ CFO: ["u1"] });
      const result = evaluateRule(
        "CURRENCY",
        { currencies: ["EUR"], roles: ["CFO"] },
        deal,
        roleUsers,
        makeSeq(),
      );
      expect(result).toHaveLength(0);
    });
  });

  describe("MULTI_APPROVER", () => {
    it("picks N unique users up to threshold", () => {
      const roleUsers = makeRoleUsers({ CFO: ["u1", "u2"], COO: ["u3"] });
      const result = evaluateRule(
        "MULTI_APPROVER",
        { threshold: 2, of: 3, roles: ["CFO", "COO"] },
        deal,
        roleUsers,
        makeSeq(),
      );
      expect(result).toHaveLength(2);
    });

    it("deduplicates across roles", () => {
      const roleUsers = makeRoleUsers({ CFO: ["u1"], COO: ["u1", "u2"] });
      const result = evaluateRule(
        "MULTI_APPROVER",
        { threshold: 2, of: 3, roles: ["CFO", "COO"] },
        deal,
        roleUsers,
        makeSeq(),
      );
      const ids = result.map((a) => a.userId);
      expect(new Set(ids).size).toBe(result.length);
    });
  });

  describe("SEQUENTIAL_APPROVAL", () => {
    it("assigns all users in order", () => {
      const roleUsers = makeRoleUsers({ CFO: ["u1"], COO: ["u2"] });
      const result = evaluateRule(
        "SEQUENTIAL_APPROVAL",
        { roles: ["CFO", "COO"] },
        deal,
        roleUsers,
        makeSeq(),
      );
      expect(result).toHaveLength(2);
      expect(result[0].sequence).toBe(0);
      expect(result[1].sequence).toBe(1);
    });
  });

  describe("PARALLEL_APPROVAL", () => {
    it("assigns all users with same sequence number", () => {
      const roleUsers = makeRoleUsers({ CFO: ["u1"], COO: ["u2"] });
      const seq = makeSeq();
      const result = evaluateRule(
        "PARALLEL_APPROVAL",
        { roles: ["CFO", "COO"] },
        deal,
        roleUsers,
        seq,
      );
      expect(result).toHaveLength(2);
      expect(result[0].sequence).toBe(result[1].sequence);
    });
  });

  describe("REQUIRED_DOCUMENTS", () => {
    it("returns empty (gate evaluation handled separately)", () => {
      const roleUsers = makeRoleUsers({ CFO: ["u1"] });
      const result = evaluateRule(
        "REQUIRED_DOCUMENTS",
        { documentTypes: ["INCOME_STATEMENT"] },
        deal,
        roleUsers,
        makeSeq(),
      );
      expect(result).toHaveLength(0);
    });
  });

  describe("REQUIRED_REQUIREMENTS", () => {
    it("returns empty (gate evaluation handled separately)", () => {
      const roleUsers = makeRoleUsers({ CFO: ["u1"] });
      const result = evaluateRule(
        "REQUIRED_REQUIREMENTS",
        { requirementIds: ["req-1"] },
        deal,
        roleUsers,
        makeSeq(),
      );
      expect(result).toHaveLength(0);
    });
  });

  describe("unknown rule type", () => {
    it("throws on unknown rule type", () => {
      const roleUsers = makeRoleUsers({ CFO: ["u1"] });
      expect(() =>
        evaluateRule(
          "UNKNOWN_RULE" as never,
          {},
          deal,
          roleUsers,
          makeSeq(),
        ),
      ).toThrow("Unknown rule type: UNKNOWN_RULE");
    });
  });
});

describe("evaluatePolicy", () => {
  it("deduplicates users across rules", async () => {
    const _roleUsers = makeRoleUsers({ CFO: ["u1"] });
    const rules = [
      { ruleType: "ROLE_APPROVAL" as const, config: { roles: ["CFO"] }, priority: 1 },
      { ruleType: "NOTIONAL_THRESHOLD" as const, config: { threshold: "100000", comparator: ">=", roles: ["CFO"] }, priority: 2 },
    ];
    const result = await evaluatePolicy(
      { policyId: "p1", policyName: "Test", rules },
      "org1",
      deal,
      {
        organizationMember: {
          findMany: async () => [
            { userId: "u1", role: { name: "CFO" } },
          ],
        },
      } as never,
    );
    expect(result).toHaveLength(1);
    expect(result[0].userId).toBe("u1");
  });

  it("respects priority ordering in assignments", async () => {
    const _roleUsers = makeRoleUsers({ CFO: ["u1"], COO: ["u2"] });
    const rules = [
      { ruleType: "ROLE_APPROVAL" as const, config: { roles: ["COO"] }, priority: 1 },
      { ruleType: "ROLE_APPROVAL" as const, config: { roles: ["CFO"] }, priority: 2 },
    ];
    const result = await evaluatePolicy(
      { policyId: "p1", policyName: "Test", rules },
      "org1",
      deal,
      {
        organizationMember: {
          findMany: async () => [
            { userId: "u1", role: { name: "CFO" } },
            { userId: "u2", role: { name: "COO" } },
          ],
        },
      } as never,
    );
    const cfo = result.find((a) => a.userId === "u1") as ApprovalAssignment;
    const coo = result.find((a) => a.userId === "u2") as ApprovalAssignment;
    expect(cfo.sequence).toBeGreaterThan(coo.sequence);
  });
});
