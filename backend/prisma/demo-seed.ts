// Demo dataset seed. Run via `npm run db:demo`.
//
// `db:seed` only syncs the system role catalog, so a fresh environment has zero
// organizations, users, or deals — nothing to demonstrate. This seed builds a
// complete, deterministic lifecycle: two organizations linked as counterparties,
// a deal negotiated through four offers, an approval workflow with a recorded
// decision, and a settlement already settled on the Canton provider with its
// full transition history and reconciliation record.
//
// Idempotent: re-running resets the demo rows by their fixed slugs/references
// instead of duplicating them. Destructive only to the rows it owns.
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";
import { hashPassword } from "../src/modules/auth/passwords.js";

const prisma = new PrismaClient();

const DEMO_SLUG = "magnitude-capital";
const COUNTERPARTY_SLUG = "northwind-holdings";
const DEMO_PASSWORD = process.env.DEMO_SEED_PASSWORD ?? "AegisDemo!2026";

/** Deterministic ids keep re-runs stable and make transitions idempotent. */
function uuid(name: string): string {
  // Build a well-formed UUIDv4-shaped string from the deterministic hash.
  const h = createHash("sha256").update(`aegis-demo:${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Zero-padded pair key: SHA-256 of the two sorted org ids (schema guard). */
function pairKey(a: string, b: string): string {
  return createHash("sha256").update([a, b].sort().join(":")).digest("hex");
}

const daysAgo = (n: number): Date => new Date(Date.now() - n * 86_400_000);
const daysAhead = (n: number): Date => new Date(Date.now() + n * 86_400_000);
const amount = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

async function main(): Promise<void> {
  // ---- 1. System roles (required for memberships) ------------------------
  const { syncSystemRoles } = await import("../src/modules/organizations/role.seed.js");
  await syncSystemRoles(prisma);
  const roles = new Map<string, string>();
  for (const r of await prisma.role.findMany({ where: { isSystem: true } })) {
    roles.set(r.name, r.id);
  }
  const roleId = (name: string): string => {
    const v = roles.get(name);
    if (!v) throw new Error(`Missing system role ${name}; run db:seed first.`);
    return v;
  };

  // ---- 2. Organizations --------------------------------------------------
  const org = await prisma.organization.upsert({
    where: { slug: DEMO_SLUG },
    update: {},
    create: {
      id: uuid("org:magnitude"),
      name: "Magnitude Capital",
      slug: DEMO_SLUG,
      legalName: "Magnitude Capital Partners LP",
      country: "GB",
      timezone: "Europe/London",
      status: "ACTIVE",
    },
  });

  const counterpartyOrg = await prisma.organization.upsert({
    where: { slug: COUNTERPARTY_SLUG },
    update: {},
    create: {
      id: uuid("org:northwind"),
      name: "Northwind Holdings",
      slug: COUNTERPARTY_SLUG,
      legalName: "Northwind Holdings SA",
      country: "CH",
      timezone: "Europe/Zurich",
      status: "ACTIVE",
    },
  });

  // ---- 3. Users ----------------------------------------------------------
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const owner = await prisma.user.upsert({
    where: { email: "aria.chen@magnitude.capital" },
    update: { passwordHash },
    create: {
      id: uuid("user:aria"),
      email: "aria.chen@magnitude.capital",
      passwordHash,
      status: "ACTIVE",
      emailVerifiedAt: daysAgo(30),
    },
  });

  const approver = await prisma.user.upsert({
    where: { email: "tom.reyes@magnitude.capital" },
    update: { passwordHash },
    create: {
      id: uuid("user:tom"),
      email: "tom.reyes@magnitude.capital",
      passwordHash,
      status: "ACTIVE",
      emailVerifiedAt: daysAgo(30),
    },
  });

  const cpUser = await prisma.user.upsert({
    where: { email: "lena.fischer@northwind.ch" },
    update: { passwordHash },
    create: {
      id: uuid("user:lena"),
      email: "lena.fischer@northwind.ch",
      passwordHash,
      status: "ACTIVE",
      emailVerifiedAt: daysAgo(30),
    },
  });

  // ---- 4. Memberships ----------------------------------------------------
  const membership = async (
    organizationId: string,
    userId: string,
    role: string,
  ): Promise<string> => {
    const existing = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });
    if (existing) return existing.id;
    return (
      await prisma.organizationMember.create({
        data: {
          organizationId,
          userId,
          roleId: roleId(role),
          status: "ACTIVE",
          joinedAt: daysAgo(30),
        },
      })
    ).id;
  };

  await membership(org.id, owner.id, "OWNER");
  await membership(org.id, approver.id, "ADMIN");
  await membership(counterpartyOrg.id, cpUser.id, "OWNER");

  // ---- 5. Counterparty link ---------------------------------------------
  await prisma.organizationCounterparty.upsert({
    where: { organizationId_counterpartyOrganizationId: { organizationId: org.id, counterpartyOrganizationId: counterpartyOrg.id } },
    update: { status: "ACTIVE", verificationStatus: "VERIFIED" },
    create: {
      id: uuid("cp:magnitude-northwind"),
      organizationId: org.id,
      counterpartyOrganizationId: counterpartyOrg.id,
      pairKey: pairKey(org.id, counterpartyOrg.id),
      status: "ACTIVE",
      verificationStatus: "VERIFIED",
      createdByUserId: owner.id,
    },
  });
  await prisma.organizationCounterparty.upsert({
    where: { organizationId_counterpartyOrganizationId: { organizationId: counterpartyOrg.id, counterpartyOrganizationId: org.id } },
    update: { status: "ACTIVE", verificationStatus: "VERIFIED" },
    create: {
      id: uuid("cp:northwind-magnitude"),
      organizationId: counterpartyOrg.id,
      counterpartyOrganizationId: org.id,
      pairKey: pairKey(counterpartyOrg.id, org.id),
      status: "ACTIVE",
      verificationStatus: "VERIFIED",
      createdByUserId: cpUser.id,
    },
  });

  // ---- 6. Deal participants ---------------------------------------------
  const ourParticipant = await prisma.dealParticipant.upsert({
    where: { dealId_organizationId: { dealId: uuid("deal:treasury"), organizationId: org.id } },
    update: { status: "ACTIVE", joinedAt: daysAgo(28) },
    create: {
      id: uuid("participant:magnitude"),
      dealId: uuid("deal:treasury"),
      organizationId: org.id,
      participantType: "OWNER",
      status: "ACTIVE",
      invitedByUserId: owner.id,
      joinedAt: daysAgo(28),
    },
  });
  const theirParticipant = await prisma.dealParticipant.upsert({
    where: { dealId_organizationId: { dealId: uuid("deal:treasury"), organizationId: counterpartyOrg.id } },
    update: { status: "ACTIVE", joinedAt: daysAgo(27) },
    create: {
      id: uuid("participant:northwind"),
      dealId: uuid("deal:treasury"),
      organizationId: counterpartyOrg.id,
      participantType: "COUNTERPARTY",
      status: "ACTIVE",
      invitedByUserId: owner.id,
      joinedAt: daysAgo(27),
    },
  });

  // ---- 7. Deal -----------------------------------------------------------
  const deal = await prisma.deal.upsert({
    where: { organizationId_reference: { organizationId: org.id, reference: "MAG-2026-0142" } },
    update: {},
    create: {
      id: uuid("deal:treasury"),
      organizationId: org.id,
      createdByUserId: owner.id,
      reference: "MAG-2026-0142",
      type: "RWA_PURCHASE",
      status: "SETTLED",
      name: "Tokenized Treasury Bill Purchase",
      description:
        "Purchase of a short-dated tokenized US Treasury bill on Canton, funded " +
        "through the Metatarz non-custodial wallet and settled via OneSwap liquidity.",
      currency: "USD",
      notionalAmount: amount("1250000.00"),
      settledAmount: amount("1250000.00"),
      settlementDate: daysAgo(3),
      createdAt: daysAgo(28),
    },
  });

  // Deal state history: DRAFT -> OPEN -> NEGOTIATING -> AGREED ->
  // APPROVAL_PENDING -> APPROVED -> SETTLEMENT_PENDING -> SETTLED
  const ladder: Array<[string, string, number, string]> = [
    ["DEAL_CREATED", "DRAFT", 28, "Deal created"],
    ["DEAL_OPENED", "OPEN", 28, "Opened for negotiation"],
    ["NEGOTIATION_STARTED", "NEGOTIATING", 27, "First offer submitted"],
    ["DEAL_AGREED", "AGREED", 21, "Counterparty accepted the final offer"],
    ["APPROVAL_REQUESTED", "APPROVAL_PENDING", 20, "Submitted for approval"],
    ["DEAL_APPROVED", "APPROVED", 19, "Approved by Risk"],
    ["SETTLEMENT_STARTED", "SETTLEMENT_PENDING", 5, "Settlement initiated"],
    ["DEAL_SETTLED", "SETTLED", 3, "Settled on Canton"],
  ];
  for (const [i, [transitionType, toStatus, age, reason]] of ladder.entries()) {
    const fromStatus = i === 0 ? "DRAFT" : ladder[i - 1][1];
    await prisma.dealStateTransition.upsert({
      where: { dealId_requestId_toStatus: { dealId: deal.id, requestId: `demo-${transitionType}`, toStatus: toStatus as never } },
      update: {},
      create: {
        dealId: deal.id,
        organizationId: org.id,
        requestId: `demo-${transitionType}`,
        transitionType,
        fromStatus: fromStatus as never,
        toStatus: toStatus as never,
        reason,
        actorUserId: owner.id,
        createdAt: daysAgo(age),
      },
    });
  }

  // ---- 8. Negotiation: four offers, each superseding the last -----------
  const offerSpecs: Array<[string, string, string, "SUBMITTED" | "COUNTERED" | "ACCEPTED", "o" | "t", number]> = [
    ["offer:1", "1300000.00", "100.5", "COUNTERED", "o", 27],
    ["offer:2", "1285000.00", "100.2", "COUNTERED", "t", 25],
    ["offer:3", "1270000.00", "100.1", "COUNTERED", "o", 23],
    ["offer:4", "1250000.00", "100.0", "ACCEPTED", "t", 21],
  ];

  let parentId: string | null = null;
  for (const [key, amt, price, status, side, age] of offerSpecs) {
    const creator = side === "o" ? ourParticipant : theirParticipant;
    const recipient = side === "o" ? theirParticipant : ourParticipant;
    const row = await prisma.offer.upsert({
      where: { id: uuid(key) },
      update: {},
      create: {
        id: uuid(key),
        dealId: deal.id,
        createdByParticipantId: creator.id,
        recipientParticipantId: recipient.id,
        parentOfferId: parentId,
        status,
        version: Number(key.split(":")[1]),
        currency: "USD",
        amount: amount(amt),
        price: amount(price),
        settlementDate: daysAgo(3),
        submittedAt: daysAgo(age),
        createdAt: daysAgo(age),
      },
    });
    await prisma.offerTransition.upsert({
      where: { offerId_requestId_toStatus: { offerId: row.id, requestId: `demo-offer-${key}`, toStatus: status } },
      update: {},
      create: {
        offerId: row.id,
        dealId: deal.id,
        requestId: `demo-offer-${key}`,
        transitionType: "OFFER_SUBMITTED",
        fromStatus: "DRAFT",
        toStatus: status,
        reason: status === "ACCEPTED" ? "Accepted by counterparty" : "Superseded by the next offer",
        actorUserId: side === "o" ? owner.id : cpUser.id,
        createdAt: daysAgo(age),
      },
    });
    parentId = row.id;
  }

  // ---- 9. Approval policy + workflow + decision -------------------------
  const policy = await prisma.approvalPolicy.upsert({
    where: { id: uuid("policy:standard") },
    update: {},
    create: {
      id: uuid("policy:standard"),
      organizationId: org.id,
      name: "Standard Institutional Approval",
      description: "Dual control on notional above USD 1,000,000.",
      status: "ACTIVE",
      priority: 10,
      createdByUserId: owner.id,
    },
  });
  await prisma.approvalPolicyRule.upsert({
    where: { id: uuid("policyrule:notional") },
    update: {},
    create: {
      id: uuid("policyrule:notional"),
      policyId: policy.id,
      ruleType: "NOTIONAL_THRESHOLD",
      priority: 10,
      config: { threshold: 1000000, currency: "USD", requiresApproval: true },
    },
  });

  const workflow = await prisma.approvalWorkflow.upsert({
    where: { dealId: deal.id },
    update: {},
    create: {
      id: uuid("workflow:treasury"),
      dealId: deal.id,
      organizationId: org.id,
      policyId: policy.id,
      status: "APPROVED",
      policySnapshot: { policy: "Standard Institutional Approval", version: 1 },
      startedAt: daysAgo(20),
      completedAt: daysAgo(19),
    },
  });

  const request = await prisma.approvalRequest.upsert({
    where: { workflowId_approverUserId: { workflowId: workflow.id, approverUserId: approver.id } },
    update: {},
    create: {
      id: uuid("approvalrequest:treasury"),
      workflowId: workflow.id,
      dealId: deal.id,
      organizationId: org.id,
      approverUserId: approver.id,
      approverRole: "ADMIN",
      sequence: 1,
      required: true,
      status: "APPROVED",
      reason: "Notional exceeds USD 1,000,000 dual-control threshold.",
      dueAt: daysAgo(18),
      respondedAt: daysAgo(19),
      createdAt: daysAgo(20),
    },
  });

  await prisma.approvalDecision.upsert({
    where: { requestId: request.id },
    update: {},
    create: {
      id: uuid("approvaldecision:treasury"),
      requestId: request.id,
      workflowId: workflow.id,
      dealId: deal.id,
      organizationId: org.id,
      actorUserId: approver.id,
      decision: "APPROVED",
      reason: "Counterparty verified and settlement route is within mandate.",
      decidedAt: daysAgo(19),
    },
  });

  // ---- 10. Settlement, already settled on Canton ------------------------
  const updateId = `0x${randomUUID().replace(/-/g, "")}`;
  await prisma.settlement.upsert({
    where: { dealId: deal.id },
    update: {},
    create: {
      id: uuid("settlement:treasury"),
      organizationId: org.id,
      dealId: deal.id,
      provider: "CANTON",
      providerReference: updateId,
      externalTransactionId: updateId,
      status: "SETTLED",
      amount: amount("1250000.00"),
      currency: "USD",
      assetIdentifier: "0xDE40000000000000000000000000000000000001",
      initiatedByUserId: owner.id,
      initiatedAt: daysAgo(5),
      submittedAt: daysAgo(4),
      completedAt: daysAgo(3),
      metadata: {
        rail: "canton-metatarz",
        liquidityRoute: "OneSwap CC/USDCx",
        signer: "non-custodial",
      },
      createdAt: daysAgo(5),
    },
  });

  const settlementId = uuid("settlement:treasury");
  const settlementLadder: Array<[string, string, string, number, string]> = [
    ["SETTLEMENT_CREATED", "CREATED", "CREATED", 5, "Settlement record created"],
    ["SETTLEMENT_SUBMITTED", "CREATED", "SUBMITTED", 4, "Canton transfer signed in Metatarz"],
    ["SETTLEMENT_PENDING", "SUBMITTED", "PENDING", 4, "Awaiting ledger confirmation"],
    ["SETTLEMENT_COMPLETED", "PENDING", "SETTLED", 3, "Canton update id confirmed on-ledger"],
  ];
  for (const [transitionType, fromStatus, toStatus, age, reason] of settlementLadder) {
    await prisma.settlementTransition.upsert({
      where: { settlementId_requestId_toStatus: { settlementId, requestId: `demo-${transitionType}`, toStatus: toStatus as never } },
      update: {},
      create: {
        settlementId,
        dealId: deal.id,
        organizationId: org.id,
        requestId: `demo-${transitionType}`,
        transitionType,
        fromStatus: fromStatus as never,
        toStatus: toStatus as never,
        reason,
        actorUserId: owner.id,
        createdAt: daysAgo(age),
      },
    });
  }

  await prisma.reconciliation.upsert({
    where: { dealId: deal.id },
    update: {},
    create: {
      id: uuid("reconciliation:treasury"),
      organizationId: org.id,
      dealId: deal.id,
      settlementId,
      status: "RECONCILED",
      expectedAmount: amount("1250000.00"),
      actualAmount: amount("1250000.00"),
      expectedCurrency: "USD",
      actualCurrency: "USD",
      resolvedByUserId: owner.id,
      resolvedAt: daysAgo(3),
      createdAt: daysAgo(3),
    },
  });

  // ---- 11. Intelligence run (advisory result on the record) --------------
  await prisma.dealIntelligenceRun.upsert({
    where: { id: uuid("intelligence:treasury") },
    update: {},
    create: {
      id: uuid("intelligence:treasury"),
      organizationId: org.id,
      dealId: deal.id,
      requestedByUserId: owner.id,
      status: "COMPLETED",
      provider: "deterministic",
      modelVersion: "aegis-mock-v1",
      analysisVersion: "1",
      inputHash: createHash("sha256").update("aegis-demo:context").digest("hex"),
      result: {
        summary:
          "Standard bilateral RWA purchase with a verified counterparty. No " +
          "unresolved settlement blockers detected at time of settlement.",
        risks: [
          "Settlement window depends on Canton ledger finality.",
          "Liquidity route depth should be re-checked for larger notionals.",
        ],
        recommendations: [
          "Confirm the deposit party address on every new counterparty.",
          "Retain the signed Canton update id with the closing record.",
        ],
      },
      confidenceSummary: { overall: 0.82, riskCount: 2, recommendationCount: 2 },
      completedAt: daysAgo(4),
    },
  });

  // ---- 12. Audit trail ---------------------------------------------------
  const auditTypes: Array<[string, number]> = [
    ["SECURITY_EVENT_LOGGED", 28],
    ["DEAL_CREATED", 28],
    ["OFFER_SUBMITTED", 27],
    ["OFFER_COUNTERED", 25],
    ["APPROVAL_REQUESTED", 20],
    ["APPROVAL_DECIDED", 19],
    ["SETTLEMENT_CREATED", 5],
    ["SETTLEMENT_SUBMITTED", 4],
    ["SETTLEMENT_COMPLETED", 3],
  ];
  for (const [type, age] of auditTypes) {
    const existing = await prisma.securityEvent.findFirst({ where: { type, organizationId: org.id } });
    if (!existing) {
      await prisma.securityEvent.create({
        data: {
          userId: owner.id,
          organizationId: org.id,
          type,
          metadata: { source: "demo-seed" },
          createdAt: daysAgo(age),
        },
      });
    }
  }

  // eslint-disable-next-line no-console
  console.log(`
Demo dataset ready.

  Sign in with any of:
    aria.chen@magnitude.capital  (OWNER, Magnitude Capital)
    tom.reyes@magnitude.capital  (ADMIN, approver)
    lena.fischer@northwind.ch    (OWNER, counterparty)
  password: ${DEMO_PASSWORD}

  Deal MAG-2026-0142 is SETTLED with four offers, an approved workflow,
  a settled Canton settlement, and a reconciled record.
`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Demo seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });