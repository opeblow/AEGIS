import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { AppError } from "../../src/lib/errors/index.js";
import { SecurityEventType } from "../../src/modules/auth/security-events.js";
import {
  initiateSettlement,
  submitSettlement,
  getSettlementStatus,
  cancelSettlement,
  getSettlementHistory,
} from "../../src/modules/settlement/settlement.service.js";
import {
  performReconciliation,
  resolveReconciliation,
  getReconciliation,
} from "../../src/modules/settlement/reconciliation/reconciliation.service.js";
import { transitionDeal } from "../../src/modules/deals/deal.service.js";
import { createDeal } from "../../src/modules/deals/deal.service.js";
import { startApprovalWorkflow } from "../../src/modules/approvals/approval-policy.service.js";
import { createRequirement } from "../../src/modules/documents/requirement.service.js";
import { satisfyRequirement } from "../../src/modules/documents/requirement.service.js";
import { submitRequirement } from "../../src/modules/documents/requirement.service.js";
import { createApprovalPolicy } from "../../src/modules/approvals/approval-policy.service.js";
import { activateApprovalPolicy } from "../../src/modules/approvals/approval-policy.service.js";
import { cantonMockProvider } from "../../src/modules/settlement/canton/canton.provider.js";
import { setSettlementProviderForTesting } from "../../src/modules/settlement/settlement.provider.js";
import type { RequestMeta } from "../../src/modules/organizations/organization.service.js";
import { registerUser } from "../../src/modules/auth/user.service.js";
import { createOrganization } from "../../src/modules/organizations/organization.service.js";

const meta: RequestMeta = { ipAddress: "127.0.0.1", userAgent: "test-agent" };

async function createTestOrgAndUser(
  email: string,
): Promise<{ organizationId: string; userId: string; accessToken: string }> {
  const { user } = await registerUser({ email, password: "TestPass123!", ipAddress: "127.0.0.1", userAgent: "test-agent" });
  const orgResult = await createOrganization(user.id, {
    name: `Test Org ${Date.now()}`,
    slug: `test-org-${Date.now()}`,
    legalName: null,
    country: "US",
    timezone: "UTC",
  }, meta);
  return { organizationId: orgResult.organization.id, userId: user.id, accessToken: "" };
}

async function setupApprovedDeal(
  organizationId: string,
  userId: string,
) {
  // Create deal
  const deal = await createDeal(
    organizationId,
    {
      type: "RWA_PURCHASE",
      name: "Test Deal",
      description: "Test deal for settlement",
      currency: "USD",
      notionalAmount: "1000000.00",
      settlementDate: new Date(Date.now() + 86400000).toISOString(),
      idempotencyKey: `deal-key-${Date.now()}`,
    },
    userId,
    meta,
  );

  // Create approval policy
  const policy = await createApprovalPolicy(
    organizationId,
    {
      name: "Test Policy",
      rules: [
        { ruleType: "NOTIONAL_THRESHOLD", config: { threshold: "100000", currency: "USD", roles: ["Owner"] } },
      ],
    },
    userId,
    meta,
  );

  await activateApprovalPolicy(organizationId, policy.policy.id, userId, meta);

  // Start workflow
  const workflow = await startApprovalWorkflow(
    organizationId,
    deal.id,
    { policyId: policy.policy.id },
    userId,
    meta,
  );

  // Approve the request (first request in workflow)
  const requests = await prisma.approvalRequest.findMany({
    where: { workflowId: workflow.workflow.id },
  });
  for (const req of requests) {
    await prisma.approvalDecision.create({
      data: {
        requestId: req.id,
        workflowId: workflow.workflow.id,
        dealId: deal.id,
        organizationId,
        actorUserId: userId,
        decision: "APPROVED",
      },
    });
    await prisma.approvalRequest.update({
      where: { id: req.id },
      data: { status: "APPROVED", respondedAt: new Date() },
    });
  }

  await prisma.approvalWorkflow.update({
    where: { id: workflow.workflow.id },
    data: { status: "APPROVED", completedAt: new Date() },
  });

  // Create requirement
  const req = await createRequirement(
    { isOwner: true, deal: deal as any, organizationId, userId },
    deal.id,
    {
      requirementType: "CONFIRMATION",
      title: "Test Requirement",
      required: true,
    },
    userId,
    meta,
  );

  // Submit requirement first (OPEN -> SUBMITTED)
  await submitRequirement(
    { isOwner: true, deal: deal as any, organizationId, userId },
    deal.id,
    req.id,
    { requestId: `submit-${Date.now()}` },
    userId,
    meta,
  );

  // Satisfy requirement (SUBMITTED -> SATISFIED)
  await satisfyRequirement(
    { isOwner: true, deal: deal as any, organizationId, userId },
    deal.id,
    req.id,
    { requestId: `sat-${Date.now()}` },
    userId,
    meta,
  );

  // Transition through deal state machine: DRAFT -> OPEN -> NEGOTIATING -> AGREED -> APPROVAL_PENDING -> APPROVED
  let currentVersion = deal.version;
  const states = ["OPEN", "NEGOTIATING", "AGREED", "APPROVAL_PENDING", "APPROVED"];
  for (const state of states) {
    const result = await transitionDeal(
      organizationId,
      deal.id,
      { toStatus: state, requestId: `trans-${state}-${Date.now()}`, version: currentVersion },
      userId,
      meta,
    );
    currentVersion = result.version;
  }

  return deal;
}

describe("Phase 8 — Settlement & Reconciliation", () => {
  let orgA: { organizationId: string; userId: string };
  let orgB: { organizationId: string; userId: string };
  let deal: { id: string; version: number };

  beforeEach(async () => {
    await cantonMockProvider.reset();
    setSettlementProviderForTesting(cantonMockProvider);

    // Clean up
    await prisma.reconciliation.deleteMany();
    await prisma.settlementTransition.deleteMany();
    await prisma.settlement.deleteMany();
    await prisma.dealStateTransition.deleteMany();
    await prisma.deal.deleteMany();
    await prisma.approvalDecision.deleteMany();
    await prisma.approvalRequest.deleteMany();
    await prisma.approvalWorkflow.deleteMany();
    await prisma.approvalPolicyRule.deleteMany();
    await prisma.approvalPolicy.deleteMany();
    await prisma.dealRequirementTransition.deleteMany();
    await prisma.dealRequirement.deleteMany();
    await prisma.dealParticipantTransition.deleteMany();
    await prisma.dealParticipantInvitation.deleteMany();
    await prisma.dealParticipant.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();

    orgA = await createTestOrgAndUser(`orga-${Date.now()}@test.com`);
    orgB = await createTestOrgAndUser(`orgb-${Date.now()}@test.com`);

    deal = await setupApprovedDeal(orgA.organizationId, orgA.userId);
  });

  afterEach(async () => {
    await cantonMockProvider.reset();
  });

  describe("Settlement Authorization", () => {
    it("rejects settlement initiation without deal access", async () => {
      await expect(
        initiateSettlement(
          orgB.organizationId,
          deal.id,
          { idempotencyKey: "test-key", requestId: "req-1" },
          orgB.userId,
          meta,
        ),
      ).rejects.toThrow(AppError);
    });

    it("rejects settlement initiation from non-member", async () => {
      await expect(
        initiateSettlement(
          "00000000-0000-0000-0000-000000000000",
          deal.id,
          { idempotencyKey: "test-key", requestId: "req-1" },
          orgA.userId,
          meta,
        ),
      ).rejects.toThrow(AppError);
    });
  });

  describe("Deal Eligibility Gates", () => {
    it("rejects settlement when deal is not APPROVED", async () => {
      // Create a deal in NEGOTIATING state
      const negotiatingDeal = await createDeal(
        orgA.organizationId,
        {
          type: "RWA_PURCHASE",
          name: "Negotiating Deal",
          currency: "USD",
          notionalAmount: "500000.00",
          idempotencyKey: `neg-deal-${Date.now()}`,
        },
        orgA.userId,
        meta,
      );

      await expect(
        initiateSettlement(
          orgA.organizationId,
          negotiatingDeal.id,
          { idempotencyKey: "test-key", requestId: "req-1" },
          orgA.userId,
          meta,
        ),
      ).rejects.toMatchObject({ code: "SETTLEMENT_NOT_READY" });
    });

    it("rejects settlement when approval workflow incomplete", async () => {
      // Create deal without approval
      const noApprovalDeal = await createDeal(
        orgA.organizationId,
        {
          type: "RWA_PURCHASE",
          name: "No Approval Deal",
          currency: "USD",
          notionalAmount: "500000.00",
          idempotencyKey: `no-approval-${Date.now()}`,
        },
        orgA.userId,
        meta,
      );

      await expect(
        initiateSettlement(
          orgA.organizationId,
          noApprovalDeal.id,
          { idempotencyKey: "test-key", requestId: "req-1" },
          orgA.userId,
          meta,
        ),
      ).rejects.toMatchObject({ code: "SETTLEMENT_NOT_READY" });
    });

    it("rejects settlement when readiness not satisfied", async () => {
      // Create deal with unmet requirement
      const dealWithReq = await createDeal(
        orgA.organizationId,
        {
          type: "RWA_PURCHASE",
          name: "Unmet Requirement Deal",
          currency: "USD",
          notionalAmount: "500000.00",
          idempotencyKey: `unmet-req-${Date.now()}`,
        },
        orgA.userId,
        meta,
      );

      // Create approval policy
      const policy = await createApprovalPolicy(
        orgA.organizationId,
        {
          name: "Test Policy",
          rules: [
            { ruleType: "REQUIRED_REQUIREMENTS", config: { requirementIds: ["req-1"] } },
          ],
        },
        orgA.userId,
        meta,
      );

      await activateApprovalPolicy(orgA.organizationId, policy.policy.id, orgA.userId, meta);
      const workflow = await startApprovalWorkflow(
        orgA.organizationId,
        dealWithReq.id,
        { policyId: policy.policy.id },
        orgA.userId,
        meta,
      );

      // Create unsatisfied requirement
      const req = await createRequirement(
        { isOwner: true, deal: dealWithReq as any, organizationId: orgA.organizationId, userId: orgA.userId },
        dealWithReq.id,
        {
          requirementType: "DOCUMENT",
          title: "Missing Document",
          required: true,
        },
        orgA.userId,
        meta,
      );

      // Update approval policy with the actual requirement ID
      await prisma.approvalPolicyRule.updateMany({
        where: { policyId: policy.policy.id },
        data: { config: { requirementIds: [req.id] } },
      });

      // Approve requests and keep workflow in PENDING for readiness check
      const requests = await prisma.approvalRequest.findMany({
        where: { workflowId: workflow.workflow.id },
      });
      for (const r of requests) {
        await prisma.approvalDecision.create({
          data: {
            requestId: r.id,
            workflowId: workflow.workflow.id,
            dealId: dealWithReq.id,
            organizationId: orgA.organizationId,
            actorUserId: orgA.userId,
            decision: "APPROVED",
          },
        });
        await prisma.approvalRequest.update({
          where: { id: r.id },
          data: { status: "APPROVED", respondedAt: new Date() },
        });
      }
      // Keep workflow in PENDING so readiness check runs
      await prisma.approvalWorkflow.update({
        where: { id: workflow.workflow.id },
        data: { status: "PENDING" },
      });

      // Transition deal through state machine to APPROVED
      let currentVersion = dealWithReq.version;
      const states = ["OPEN", "NEGOTIATING", "AGREED", "APPROVAL_PENDING", "APPROVED"];
      for (const state of states) {
        const result = await transitionDeal(
          orgA.organizationId,
          dealWithReq.id,
          { toStatus: state, requestId: `trans-${state}-${Date.now()}`, version: currentVersion },
          orgA.userId,
          meta,
        );
        currentVersion = result.version;
      }

      await expect(
        initiateSettlement(
          orgA.organizationId,
          dealWithReq.id,
          { idempotencyKey: "test-key", requestId: "req-1" },
          orgA.userId,
          meta,
        ),
      ).rejects.toMatchObject({ code: "SETTLEMENT_NOT_READY" });
    });
  });

  describe("Settlement Creation", () => {
    it("creates settlement with CREATED status", async () => {
      const result = await initiateSettlement(
        orgA.organizationId,
        deal.id,
        { idempotencyKey: `settle-${Date.now()}`, requestId: "req-1" },
        orgA.userId,
        meta,
      );

      expect(result.replay).toBe(false);
      expect(result.settlement.status).toBe("CREATED");
      expect(result.settlement.amount).toBe("1000000");
      expect(result.settlement.currency).toBe("USD");
      expect(result.settlement.provider).toBe("MOCK");
    });

    it("transitions deal to SETTLEMENT_PENDING on creation", async () => {
      await initiateSettlement(
        orgA.organizationId,
        deal.id,
        { idempotencyKey: `settle-${Date.now()}`, requestId: "req-1" },
        orgA.userId,
        meta,
      );

      const updatedDeal = await prisma.deal.findUnique({ where: { id: deal.id } });
      expect(updatedDeal?.status).toBe("SETTLEMENT_PENDING");
    });

    it("audits SETTLEMENT_CREATED event", async () => {
      await initiateSettlement(
        orgA.organizationId,
        deal.id,
        { idempotencyKey: `settle-${Date.now()}`, requestId: "req-1" },
        orgA.userId,
        meta,
      );

      const events = await prisma.securityEvent.findMany({
        where: { type: SecurityEventType.SETTLEMENT_CREATED },
      });
      expect(events.length).toBe(1);
      expect(events[0].metadata).toMatchObject({
        dealId: deal.id,
        settlementId: expect.any(String),
        requestId: expect.any(String),
      });
    });

    it("enforces idempotency on creation", async () => {
      // Create a fresh deal in APPROVED state
      const freshDeal = await setupApprovedDeal(orgA.organizationId, orgA.userId);
      const idempotencyKey = `idempotent-${Date.now()}`;

      const first = await initiateSettlement(
        orgA.organizationId,
        freshDeal.id,
        { idempotencyKey, requestId: "req-1" },
        orgA.userId,
        meta,
      );

      const second = await initiateSettlement(
        orgA.organizationId,
        freshDeal.id,
        { idempotencyKey, requestId: "req-1" },
        orgA.userId,
        meta,
      );

      expect(second.replay).toBe(true);
      expect(second.settlement.id).toBe(first.settlement.id);
    });

    it("rejects idempotency key reuse with different payload", async () => {
      // Create a fresh deal in APPROVED state
      const freshDeal = await setupApprovedDeal(orgA.organizationId, orgA.userId);
      const idempotencyKey = `conflict-${Date.now()}`;

      await initiateSettlement(
        orgA.organizationId,
        freshDeal.id,
        { idempotencyKey, requestId: "req-1" },
        orgA.userId,
        meta,
      );

      await expect(
        initiateSettlement(
          orgA.organizationId,
          freshDeal.id,
          { idempotencyKey, requestId: "req-different" },
          orgA.userId,
          meta,
        ),
      ).rejects.toMatchObject({ code: "SETTLEMENT_IDEMPOTENCY_CONFLICT" });
    });

    it("prevents duplicate settlement for same deal", async () => {
      // Create a fresh deal in APPROVED state
      const freshDeal = await setupApprovedDeal(orgA.organizationId, orgA.userId);
      await initiateSettlement(
        orgA.organizationId,
        freshDeal.id,
        { idempotencyKey: `settle-${Date.now()}`, requestId: "req-1" },
        orgA.userId,
        meta,
      );

      await expect(
        initiateSettlement(
          orgA.organizationId,
          freshDeal.id,
          { idempotencyKey: `settle-${Date.now()}-2`, requestId: "req-2" },
          orgA.userId,
          meta,
        ),
      ).rejects.toMatchObject({ code: "SETTLEMENT_IDEMPOTENCY_CONFLICT" });
    });
  });

  describe("Settlement Submission", () => {
    it("submits settlement to provider", async () => {
      const settlementResult = await initiateSettlement(
        orgA.organizationId,
        deal.id,
        { idempotencyKey: `settle-${Date.now()}`, requestId: "req-1" },
        orgA.userId,
        meta,
      );

      const submitResult = await submitSettlement(
        orgA.organizationId,
        settlementResult.settlement.id,
        orgA.userId,
        meta,
      );

      expect(submitResult.settlement.status).toBe("SUBMITTED");
      expect(submitResult.settlement.providerReference).toBeTruthy();
    });

    it("audits SETTLEMENT_SUBMITTED event", async () => {
      const settlementResult = await initiateSettlement(
        orgA.organizationId,
        deal.id,
        { idempotencyKey: `settle-${Date.now()}`, requestId: "req-1" },
        orgA.userId,
        meta,
      );

      await submitSettlement(orgA.organizationId, settlementResult.settlement.id, orgA.userId, meta);

      const events = await prisma.securityEvent.findMany({
        where: { type: SecurityEventType.SETTLEMENT_SUBMITTED },
      });
      expect(events.length).toBe(1);
      expect(events[0].metadata).toMatchObject({
        settlementId: settlementResult.settlement.id,
        dealId: deal.id,
      });
    });

    it("handles provider failure", async () => {
      // Use a provider that will fail
      const failingProvider = {
        name: "MOCK" as const,
        async submit() {
          throw new Error("Provider down");
        },
        async getStatus() {
          throw new Error("Provider down");
        },
      };
      setSettlementProviderForTesting(failingProvider);

      // Create a fresh deal in APPROVED state
      const freshDeal = await setupApprovedDeal(orgA.organizationId, orgA.userId);

      const settlementResult = await initiateSettlement(
        orgA.organizationId,
        freshDeal.id,
        { idempotencyKey: `settle-${Date.now()}`, requestId: "req-1" },
        orgA.userId,
        meta,
      );

      const result = await submitSettlement(orgA.organizationId, settlementResult.settlement.id, orgA.userId, meta);
      expect(result.settlement.status).toBe("FAILED");
      expect(result.transition.toStatus).toBe("FAILED");

      const settlement = await prisma.settlement.findUnique({ where: { id: settlementResult.settlement.id } });
      expect(settlement?.status).toBe("FAILED");

      // Reset to mock provider
      setSettlementProviderForTesting(cantonMockProvider);
    });
  });

  describe("Settlement Status & Polling", () => {
    it("returns current settlement status", async () => {
      const settlementResult = await initiateSettlement(
        orgA.organizationId,
        deal.id,
        { idempotencyKey: `settle-${Date.now()}`, requestId: "req-1" },
        orgA.userId,
        meta,
      );

      const statusResult = await getSettlementStatus(
        orgA.organizationId,
        settlementResult.settlement.id,
        orgA.userId,
      );

      expect(statusResult.settlement.id).toBe(settlementResult.settlement.id);
      expect(statusResult.settlement.status).toBe("CREATED");
    });

    it("updates status from provider on poll", async () => {
      const settlementResult = await initiateSettlement(
        orgA.organizationId,
        deal.id,
        { idempotencyKey: `settle-${Date.now()}`, requestId: "req-1" },
        orgA.userId,
        meta,
      );

      await submitSettlement(orgA.organizationId, settlementResult.settlement.id, orgA.userId, meta);

      // Wait for mock provider to transition
      await new Promise((r) => setTimeout(r, 2000));

      const statusResult = await getSettlementStatus(
        orgA.organizationId,
        settlementResult.settlement.id,
        orgA.userId,
      );

      expect(["SUBMITTED", "PENDING", "SETTLED"]).toContain(statusResult.settlement.status);
    });
  });

  describe("Settlement Completion Flow", () => {
    it("transitions deal to SETTLED on provider completion", async () => {
      const settlementResult = await initiateSettlement(
        orgA.organizationId,
        deal.id,
        { idempotencyKey: `settle-${Date.now()}`, requestId: "req-1" },
        orgA.userId,
        meta,
      );

      const submitResult = await submitSettlement(orgA.organizationId, settlementResult.settlement.id, orgA.userId, meta);

      // Simulate provider completion
      cantonMockProvider.simulateCompletion(submitResult.settlement.providerReference!);

      // Poll to trigger state transition
      await new Promise((r) => setTimeout(r, 100));
      await getSettlementStatus(orgA.organizationId, settlementResult.settlement.id, orgA.userId);

      const updatedDeal = await prisma.deal.findUnique({ where: { id: deal.id } });
      expect(updatedDeal?.status).toBe("SETTLED");
    });

    it("audits SETTLEMENT_COMPLETED on success", async () => {
      const settlementResult = await initiateSettlement(
        orgA.organizationId,
        deal.id,
        { idempotencyKey: `settle-${Date.now()}`, requestId: "req-1" },
        orgA.userId,
        meta,
      );

      const submitResult = await submitSettlement(orgA.organizationId, settlementResult.settlement.id, orgA.userId, meta);
      cantonMockProvider.simulateCompletion(submitResult.settlement.providerReference!);
      await new Promise((r) => setTimeout(r, 100));
      await getSettlementStatus(orgA.organizationId, settlementResult.settlement.id, orgA.userId);

      const events = await prisma.securityEvent.findMany({
        where: { type: SecurityEventType.SETTLEMENT_COMPLETED },
      });
      expect(events.length).toBe(1);
    });
  });

  describe("Settlement Cancellation", () => {
    it("cancels pending settlement", async () => {
      const settlementResult = await initiateSettlement(
        orgA.organizationId,
        deal.id,
        { idempotencyKey: `settle-${Date.now()}`, requestId: "req-1" },
        orgA.userId,
        meta,
      );

      await cancelSettlement(orgA.organizationId, settlementResult.settlement.id, orgA.userId, meta);

      const settlement = await prisma.settlement.findUnique({ where: { id: settlementResult.settlement.id } });
      expect(settlement?.status).toBe("CANCELLED");
    });

    it("transitions deal to CANCELLED on settlement cancellation", async () => {
      const settlementResult = await initiateSettlement(
        orgA.organizationId,
        deal.id,
        { idempotencyKey: `settle-${Date.now()}`, requestId: "req-1" },
        orgA.userId,
        meta,
      );

      await cancelSettlement(orgA.organizationId, settlementResult.settlement.id, orgA.userId, meta);

      const updatedDeal = await prisma.deal.findUnique({ where: { id: deal.id } });
      expect(updatedDeal?.status).toBe("CANCELLED");
    });

    it("rejects cancellation of settled settlement", async () => {
      const settlementResult = await initiateSettlement(
        orgA.organizationId,
        deal.id,
        { idempotencyKey: `settle-${Date.now()}`, requestId: "req-1" },
        orgA.userId,
        meta,
      );

      const submitResult = await submitSettlement(orgA.organizationId, settlementResult.settlement.id, orgA.userId, meta);
      cantonMockProvider.simulateCompletion(submitResult.settlement.providerReference!);
      await new Promise((r) => setTimeout(r, 100));
      await getSettlementStatus(orgA.organizationId, settlementResult.settlement.id, orgA.userId);

      await expect(
        cancelSettlement(orgA.organizationId, settlementResult.settlement.id, orgA.userId, meta),
      ).rejects.toMatchObject({ code: "SETTLEMENT_STATE_CONFLICT" });
    });
  });

  describe("Reconciliation", () => {
    it("creates MATCHED reconciliation on exact match", async () => {
      const settlementResult = await initiateSettlement(
        orgA.organizationId,
        deal.id,
        { idempotencyKey: `settle-${Date.now()}`, requestId: "req-1" },
        orgA.userId,
        meta,
      );

      const submitResult = await submitSettlement(orgA.organizationId, settlementResult.settlement.id, orgA.userId, meta);
      cantonMockProvider.simulateCompletion(submitResult.settlement.providerReference!);
      await new Promise((r) => setTimeout(r, 100));
      await getSettlementStatus(orgA.organizationId, settlementResult.settlement.id, orgA.userId);

      const result = await performReconciliation(
        orgA.organizationId,
        settlementResult.settlement.id,
        orgA.userId,
        meta,
      );

      expect(result.matched).toBe(true);
      expect(result.reconciliation.status).toBe("MATCHED");
    });

    it("creates MISMATCHED reconciliation on state mismatch", async () => {
      const settlementResult = await initiateSettlement(
        orgA.organizationId,
        deal.id,
        { idempotencyKey: `settle-${Date.now()}`, requestId: "req-1" },
        orgA.userId,
        meta,
      );

      const submitResult = await submitSettlement(orgA.organizationId, settlementResult.settlement.id, orgA.userId, meta);
      // Complete the settlement first
      cantonMockProvider.simulateCompletion(submitResult.settlement.providerReference!);
      await new Promise((r) => setTimeout(r, 100));
      await getSettlementStatus(orgA.organizationId, settlementResult.settlement.id, orgA.userId);

      // Now simulate provider failure to create mismatch
      cantonMockProvider.simulateFailure(submitResult.settlement.providerReference!);

      const result = await performReconciliation(
        orgA.organizationId,
        settlementResult.settlement.id,
        orgA.userId,
        meta,
      );

      expect(result.matched).toBe(false);
      expect(result.reconciliation.status).toBe("MISMATCHED");
      expect(result.reconciliation.mismatchReason).toContain("Provider state is");
    });

    it("audits RECONCILIATION_MATCHED event", async () => {
      const settlementResult = await initiateSettlement(
        orgA.organizationId,
        deal.id,
        { idempotencyKey: `settle-${Date.now()}`, requestId: "req-1" },
        orgA.userId,
        meta,
      );

      const submitResult = await submitSettlement(orgA.organizationId, settlementResult.settlement.id, orgA.userId, meta);
      cantonMockProvider.simulateCompletion(submitResult.settlement.providerReference!);
      await new Promise((r) => setTimeout(r, 100));
      await getSettlementStatus(orgA.organizationId, settlementResult.settlement.id, orgA.userId);

      await performReconciliation(orgA.organizationId, settlementResult.settlement.id, orgA.userId, meta);

      const events = await prisma.securityEvent.findMany({
        where: { type: SecurityEventType.RECONCILIATION_MATCHED },
      });
      expect(events.length).toBe(1);
    });

    it("audits RECONCILIATION_MISMATCHED event", async () => {
      const settlementResult = await initiateSettlement(
        orgA.organizationId,
        deal.id,
        { idempotencyKey: `settle-${Date.now()}`, requestId: "req-1" },
        orgA.userId,
        meta,
      );

      const submitResult = await submitSettlement(orgA.organizationId, settlementResult.settlement.id, orgA.userId, meta);
      // Complete the settlement first
      cantonMockProvider.simulateCompletion(submitResult.settlement.providerReference!);
      await new Promise((r) => setTimeout(r, 100));
      await getSettlementStatus(orgA.organizationId, settlementResult.settlement.id, orgA.userId);

      // Now simulate provider failure to create mismatch
      cantonMockProvider.simulateFailure(submitResult.settlement.providerReference!);

      await performReconciliation(orgA.organizationId, settlementResult.settlement.id, orgA.userId, meta);

      const events = await prisma.securityEvent.findMany({
        where: { type: SecurityEventType.RECONCILIATION_MISMATCHED },
      });
      expect(events.length).toBe(1);
    });
  });

  describe("Reconciliation Resolution", () => {
    it("resolves mismatched reconciliation", async () => {
      const settlementResult = await initiateSettlement(
        orgA.organizationId,
        deal.id,
        { idempotencyKey: `settle-${Date.now()}`, requestId: "req-1" },
        orgA.userId,
        meta,
      );

      const submitResult = await submitSettlement(orgA.organizationId, settlementResult.settlement.id, orgA.userId, meta);
      cantonMockProvider.simulateCompletion(submitResult.settlement.providerReference!);
      await new Promise((r) => setTimeout(r, 100));
      await getSettlementStatus(orgA.organizationId, settlementResult.settlement.id, orgA.userId);

      // Create mismatch by simulating provider failure
      cantonMockProvider.simulateFailure(submitResult.settlement.providerReference!);

      const reconResult = await performReconciliation(
        orgA.organizationId,
        settlementResult.settlement.id,
        orgA.userId,
        meta,
      );

      expect(reconResult.matched).toBe(false);

      const resolved = await resolveReconciliation(
        orgA.organizationId,
        reconResult.reconciliation.id,
        { requestId: `resolve-${Date.now()}`, resolutionReason: "Manual verification confirmed" },
        orgA.userId,
        meta,
      );

      expect(resolved.status).toBe("RESOLVED");
    });

    it("transitions deal to COMPLETED on resolution", async () => {
      const settlementResult = await initiateSettlement(
        orgA.organizationId,
        deal.id,
        { idempotencyKey: `settle-${Date.now()}`, requestId: "req-1" },
        orgA.userId,
        meta,
      );

      const submitResult = await submitSettlement(orgA.organizationId, settlementResult.settlement.id, orgA.userId, meta);
      cantonMockProvider.simulateCompletion(submitResult.settlement.providerReference!);
      await new Promise((r) => setTimeout(r, 100));
      await getSettlementStatus(orgA.organizationId, settlementResult.settlement.id, orgA.userId);

      // Create mismatch by simulating provider failure
      cantonMockProvider.simulateFailure(submitResult.settlement.providerReference!);

      const reconResult = await performReconciliation(
        orgA.organizationId,
        settlementResult.settlement.id,
        orgA.userId,
        meta,
      );

      await resolveReconciliation(
        orgA.organizationId,
        reconResult.reconciliation.id,
        { requestId: `resolve-${Date.now()}`, resolutionReason: "Confirmed" },
        orgA.userId,
        meta,
      );

      const updatedDeal = await prisma.deal.findUnique({ where: { id: deal.id } });
      expect(updatedDeal?.status).toBe("COMPLETED");
    });

    it("rejects resolution of already matched reconciliation", async () => {
      const settlementResult = await initiateSettlement(
        orgA.organizationId,
        deal.id,
        { idempotencyKey: `settle-${Date.now()}`, requestId: "req-1" },
        orgA.userId,
        meta,
      );

      const submitResult = await submitSettlement(orgA.organizationId, settlementResult.settlement.id, orgA.userId, meta);
      cantonMockProvider.simulateCompletion(submitResult.settlement.providerReference!);
      await new Promise((r) => setTimeout(r, 100));
      await getSettlementStatus(orgA.organizationId, settlementResult.settlement.id, orgA.userId);

      const reconResult = await performReconciliation(
        orgA.organizationId,
        settlementResult.settlement.id,
        orgA.userId,
        meta,
      );

      await expect(
        resolveReconciliation(
          orgA.organizationId,
          reconResult.reconciliation.id,
          { requestId: `resolve-${Date.now()}`, resolutionReason: "Test" },
          orgA.userId,
          meta,
        ),
      ).rejects.toMatchObject({ code: "RECONCILIATION_STATE_CONFLICT" });
    });

    it("rejects unauthorized reconciliation resolution", async () => {
      const settlementResult = await initiateSettlement(
        orgA.organizationId,
        deal.id,
        { idempotencyKey: `settle-${Date.now()}`, requestId: "req-1" },
        orgA.userId,
        meta,
      );

      const submitResult = await submitSettlement(orgA.organizationId, settlementResult.settlement.id, orgA.userId, meta);
      cantonMockProvider.simulateCompletion(submitResult.settlement.providerReference!);
      await new Promise((r) => setTimeout(r, 100));
      await getSettlementStatus(orgA.organizationId, settlementResult.settlement.id, orgA.userId);

      const reconResult = await performReconciliation(
        orgA.organizationId,
        settlementResult.settlement.id,
        orgA.userId,
        meta,
      );

      await expect(
        resolveReconciliation(
          orgB.organizationId,
          reconResult.reconciliation.id,
          { requestId: `resolve-${Date.now()}`, resolutionReason: "Test" },
          orgB.userId,
          meta,
        ),
      ).rejects.toMatchObject({ code: "RECONCILIATION_NOT_FOUND" });
    });
  });

  describe("Settlement History", () => {
    it("returns transition history", async () => {
      const settlementResult = await initiateSettlement(
        orgA.organizationId,
        deal.id,
        { idempotencyKey: `settle-${Date.now()}`, requestId: "req-1" },
        orgA.userId,
        meta,
      );

      await submitSettlement(orgA.organizationId, settlementResult.settlement.id, orgA.userId, meta);

      const history = await getSettlementHistory(orgA.organizationId, settlementResult.settlement.id, {});

      expect(history.transitions.length).toBeGreaterThanOrEqual(2); // CREATED + SUBMITTING + SUBMITTED
      expect(history.transitions[0].fromStatus).toBe("CREATED");
      expect(history.transitions[0].toStatus).toBe("CREATED");
    });
  });

  describe("Cross-Organization Isolation", () => {
    it("prevents cross-org settlement access", async () => {
      const settlementResult = await initiateSettlement(
        orgA.organizationId,
        deal.id,
        { idempotencyKey: `settle-${Date.now()}`, requestId: "req-1" },
        orgA.userId,
        meta,
      );

      await expect(
        getSettlementStatus(orgB.organizationId, settlementResult.settlement.id, orgB.userId),
      ).rejects.toMatchObject({ code: "SETTLEMENT_NOT_FOUND" });
    });

    it("prevents cross-org reconciliation access", async () => {
      const settlementResult = await initiateSettlement(
        orgA.organizationId,
        deal.id,
        { idempotencyKey: `settle-${Date.now()}`, requestId: "req-1" },
        orgA.userId,
        meta,
      );

      const submitResult = await submitSettlement(orgA.organizationId, settlementResult.settlement.id, orgA.userId, meta);
      cantonMockProvider.simulateCompletion(submitResult.settlement.providerReference!);
      await new Promise((r) => setTimeout(r, 100));
      await getSettlementStatus(orgA.organizationId, settlementResult.settlement.id, orgA.userId);

      const reconResult = await performReconciliation(
        orgA.organizationId,
        settlementResult.settlement.id,
        orgA.userId,
        meta,
      );

      await expect(
        getReconciliation(orgB.organizationId, reconResult.reconciliation.id),
      ).rejects.toMatchObject({ code: "RECONCILIATION_NOT_FOUND" });
    });
  });

  describe("Concurrency Protection", () => {
    it("prevents concurrent settlement creation", async () => {
      const idempotencyKey = `concurrent-${Date.now()}`;

      const [result1, result2] = await Promise.allSettled([
        initiateSettlement(
          orgA.organizationId,
          deal.id,
          { idempotencyKey, requestId: "req-1" },
          orgA.userId,
          meta,
        ),
        initiateSettlement(
          orgA.organizationId,
          deal.id,
          { idempotencyKey, requestId: "req-2" },
          orgA.userId,
          meta,
        ),
      ]);

      const successful = [result1, result2].filter((r) => r.status === "fulfilled");
      expect(successful.length).toBe(1);
    });
  });
});