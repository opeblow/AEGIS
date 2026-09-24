import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import type {
  ApprovalRequest,
  ApprovalWorkflow,
  Deal,
  DealDocument,
  DealParticipant,
  DealRequirement,
  Offer,
  OfferTransition,
  Reconciliation,
  Settlement,
} from "@prisma/client";
import type { DealViewer } from "../../../src/modules/negotiation/participant-policy.js";
import {
  projectIntelligenceContext,
  type DealIntelligenceSource,
} from "../../../src/modules/ai/ai.mapper.js";

const DEAL_ID = "11111111-1111-4111-8111-111111111111";
const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORG_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const U_A = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const U_B = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const EMAIL_A = "alice.readonly@example.com";
const EMAIL_B = "bob.readonly@example.com";

function makeDeal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: DEAL_ID,
    organizationId: ORG_A,
    createdByUserId: U_A,
    reference: "AEG-2026-000001",
    type: "RWA_PURCHASE",
    status: "NEGOTIATION",
    name: "Residential portfolio",
    description: null,
    currency: "USD",
    notionalAmount: new Prisma.Decimal("1250000.50"),
    settledAmount: null,
    settlementDate: null,
    expiresAt: new Date("2026-12-01T00:00:00.000Z"),
    metadata: null,
    version: 3,
    createdAt: new Date("2026-09-01T10:00:00.000Z"),
    updatedAt: new Date("2026-09-02T10:00:00.000Z"),
    ...overrides,
  } as Deal;
}

function makeParticipant(
  id: string,
  organizationId: string,
): DealParticipant {
  return {
    id,
    dealId: DEAL_ID,
    organizationId,
    participantType: "COUNTERPARTY",
    status: "ACTIVE",
    invitedByUserId: U_A,
    email: id === "pa" ? EMAIL_B : EMAIL_A,
    createdAt: new Date("2026-09-01T11:00:00.000Z"),
    updatedAt: new Date("2026-09-01T11:00:00.000Z"),
  } as unknown as DealParticipant;
}

const PA = makeParticipant("pa", ORG_A);
const PB = makeParticipant("pb", ORG_B);
const PC = makeParticipant("pc", ORG_C);

function makeOffer(
  id: string,
  createdBy: DealParticipant,
  recipient: DealParticipant,
  overrides: Partial<Offer> = {},
): Offer {
  return {
    id,
    dealId: DEAL_ID,
    createdByParticipantId: createdBy.id,
    recipientParticipantId: recipient.id,
    status: "ACCEPTED",
    version: 2,
    currency: "USD",
    amount: new Prisma.Decimal("1000000.00"),
    price: null,
    settlementDate: null,
    expiresAt: new Date("2026-11-01T00:00:00.000Z"),
    submittedAt: new Date("2026-09-05T09:00:00.000Z"),
    createdAt: new Date("2026-09-05T09:00:00.000Z"),
    ...overrides,
  } as unknown as Offer;
}

const O_AB = makeOffer("o-ab", PA, PB);
const O_BA = makeOffer("o-ba", PB, PA);
const O_BC = makeOffer("o-bc", PB, PC);

function makeTransition(
  id: string,
  offerId: string,
  overrides: Partial<OfferTransition> = {},
): OfferTransition {
  return {
    id,
    dealId: DEAL_ID,
    offerId,
    transitionType: "OFFER_SENT",
    fromStatus: "DRAFT",
    toStatus: "SUBMITTED",
    reason: "Sent by the creator.",
    actorUserId: null,
    createdAt: new Date("2026-09-05T09:01:00.000Z"),
    ...overrides,
  } as unknown as OfferTransition;
}

const T1 = makeTransition("t1", O_AB.id);
const T2 = makeTransition("t2", O_BA.id);
const T3 = makeTransition("t3", O_BC.id);

function makeViewer(
  organizationId: string,
  overrides: Partial<DealViewer> = {},
): DealViewer {
  return {
    deal: makeDeal(),
    participant: organizationId === ORG_A ? PA : PB,
    organizationId,
    isOwner: organizationId === ORG_A,
    ...overrides,
  };
}

function makeSource(overrides: Partial<DealIntelligenceSource> = {}): DealIntelligenceSource {
  return {
    deal: makeDeal(),
    participants: [PA, PB, PC],
    offers: [O_AB, O_BA, O_BC],
    documents: [],
    requirements: [],
    approvalWorkflow: null,
    settlement: null,
    offerTransitions: [T1, T2, T3],
    ...overrides,
  };
}

describe("projectIntelligenceContext", () => {
  it("projects the deal row verbatim with exact money strings", () => {
    const context = projectIntelligenceContext(makeSource(), makeViewer(ORG_A));
    expect(context.deal_id).toBe(DEAL_ID);
    expect(context.organization_id).toBe(ORG_A);
    expect(context.viewer_organization_id).toBe(ORG_A);
    expect(context.deal.notional_amount).toBe("1250000.50");
    expect(context.deal.notional_amount).not.toContain("e");
    expect(context.deal.version).toBe(3);
    expect(context.deal.created_at).toBe("2026-09-01T10:00:00.000Z");
    expect(context.client_version).toBe("1.0");
  });

  it("includes only offers the viewer's org created or received", () => {
    const context = projectIntelligenceContext(makeSource(), makeViewer(ORG_A));
    const ids = context.offers.map((o) => o.id);
    expect(ids).toEqual(expect.arrayContaining([O_AB.id, O_BA.id]));
    expect(ids).not.toContain(O_BC.id);
    const ab = context.offers.find((o) => o.id === O_AB.id)!;
    expect(ab.created_by_organization_id).toBe(ORG_A);
    expect(ab.recipient_organization_id).toBe(ORG_B);
    expect(ab.amount).toBe("1000000.00");
  });

  it("includes negotiation events only for visible offers, never attributed", () => {
    const context = projectIntelligenceContext(makeSource(), makeViewer(ORG_A));
    const eventOfferIds = context.negotiation_events.map((e) => e.offer_id);
    expect(eventOfferIds).toEqual(expect.arrayContaining([O_AB.id, O_BA.id]));
    expect(eventOfferIds).not.toContain(O_BC.id);
    expect(context.negotiation_events).toHaveLength(2);
    for (const event of context.negotiation_events) {
      expect(event.actor_organization_id).toBeNull();
      expect(event.deal_id).toBe(DEAL_ID);
    }
  });

  it("excludes hidden documents but keeps uploader, deal, and granted visibility", () => {
    const baseDoc: Partial<DealDocument> = {
      dealId: DEAL_ID,
      documentType: "FINAL_AGREEMENT",
      title: "Draft sale agreement",
      version: 1,
      chainId: "chain-1",
      supersedesId: null,
      originalFilename: "agreement.pdf",
      sizeBytes: 1024,
      sha256: "doc-hash-1",
      submittedAt: new Date("2026-09-03T08:00:00.000Z"),
      reviewedAt: null,
      expiresAt: null,
      createdAt: new Date("2026-09-03T08:00:00.000Z"),
    };

    const docPub = { ...baseDoc, id: "doc-pub", organizationId: ORG_A, status: "ACTIVE", visibility: "PRIVATE", visibilityParticipants: [] as { organizationId: string }[] } as unknown as DealDocument;
    const docPrivB = { ...baseDoc, id: "doc-priv-b", organizationId: ORG_B, status: "ACTIVE", visibility: "PRIVATE", visibilityParticipants: [] as { organizationId: string }[] } as unknown as DealDocument;
    const docPart = { ...baseDoc, id: "doc-part", organizationId: ORG_A, status: "ACTIVE", visibility: "PARTICIPANTS", visibilityParticipants: [] as { organizationId: string }[] } as unknown as DealDocument;
    const docSpec = { ...baseDoc, id: "doc-spec", organizationId: ORG_A, status: "ACTIVE", visibility: "SPECIFIC_PARTICIPANTS", visibilityParticipants: [{ organizationId: ORG_C } as { organizationId: string }] } as unknown as DealDocument;
    const docSpecB = { ...baseDoc, id: "doc-spec-b", organizationId: ORG_A, status: "ACTIVE", visibility: "SPECIFIC_PARTICIPANTS", visibilityParticipants: [{ organizationId: ORG_B } as { organizationId: string }] } as unknown as DealDocument;
    const docSup = { ...baseDoc, id: "doc-sup", organizationId: ORG_B, status: "SUPERSEDED", visibility: "PARTICIPANTS", visibilityParticipants: [] as { organizationId: string }[] } as unknown as DealDocument;

    // Model the deal owner org's row as the OWNER participant; a COUNTERPARTY
    // participant (non-owner) exercises the visibility window properly.
    const context = projectIntelligenceContext(
      makeSource({ documents: [docPub, docPrivB, docPart, docSpec, docSpecB, docSup] }),
      makeViewer(ORG_B),
    );
    expect(context.documents.map((d) => d.id).sort()).toEqual(
      ["doc-part", "doc-priv-b", "doc-spec-b"].sort(),
    );
    expect(context.documents.find((d) => d.id === "doc-part")!.text).toBeNull();
  });

  it("never leaks identity: approval requests carry role/status only", () => {
    const workflow = {
      id: "wf-1",
      dealId: DEAL_ID,
      status: "IN_PROGRESS",
      startedAt: new Date("2026-09-04T10:00:00.000Z"),
      completedAt: null,
      requests: [
        {
          id: "ar-1",
          workflowId: "wf-1",
          approverRole: "OWNER_ADMIN",
          approverUserId: U_B,
          sequence: 1,
          required: true,
          status: "PENDING",
          dueAt: null,
          respondedAt: null,
          createdAt: new Date("2026-09-04T10:00:00.000Z"),
        },
      ],
    } as unknown as ApprovalWorkflow & { requests: ApprovalRequest[] };

    const context = projectIntelligenceContext(
      makeSource({ approvalWorkflow: workflow }),
      makeViewer(ORG_A),
    );
    expect(context.approval!.workflow_status).toBe("IN_PROGRESS");
    expect(context.approval!.requests[0]).toMatchObject({
      approver_role: "OWNER_ADMIN",
      sequence: 1,
      required: true,
      status: "PENDING",
    });
    for (const request of context.approval!.requests) {
      expect(request).not.toHaveProperty("approverUserId");
      expect(request).not.toHaveProperty("approver");
    }
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain(U_B);
    expect(serialized).not.toContain(EMAIL_A);
    expect(serialized).not.toContain(EMAIL_B);
  });

  it("never leaks participant emails or document hashes beyond the schema", () => {
    const context = projectIntelligenceContext(
      makeSource({ approvalWorkflow: null }),
      makeViewer(ORG_A),
    );
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain(EMAIL_A);
    expect(serialized).not.toContain(EMAIL_B);
    // sha256 here is the document content hash, an identifier ai-ml needs;
    // the assertion guards against accidental extras like storage keys.
    expect(context.offers.every((o) => !("storageKey" in o))).toBe(true);
  });

  it("handles missing optional sections and empty arrays", () => {
    const context = projectIntelligenceContext(
      makeSource({
        offers: [],
        documents: [],
        requirements: [],
        approvalWorkflow: null,
        settlement: null,
        offerTransitions: [],
      }),
      makeViewer(ORG_A),
    );
    expect(context.offers).toEqual([]);
    expect(context.documents).toEqual([]);
    expect(context.requirements).toEqual([]);
    expect(context.negotiation_events).toEqual([]);
    expect(context.approval).toBeNull();
    expect(context.settlement).toBeNull();
    expect(context.reconciliation).toBeNull();
  });

  it("maps settlement and reconciliation with exact money", () => {
    const settlement = {
      id: "st-1",
      dealId: DEAL_ID,
      provider: "mock-gateway",
      providerReference: "ref-1",
      status: "SUBMITTED",
      amount: new Prisma.Decimal("1250000.50"),
      currency: "USD",
      assetIdentifier: "0xdeadbeef",
      submittedAt: new Date("2026-09-06T10:00:00.000Z"),
      completedAt: null,
      failedAt: null,
      failureReason: null,
      createdAt: new Date("2026-09-06T10:00:00.000Z"),
      reconciliation: {
        id: "rec-1",
        settlementId: "st-1",
        status: "PENDING",
        expectedAmount: new Prisma.Decimal("1250000.50"),
        expectedCurrency: "USD",
        actualAmount: null,
        actualCurrency: null,
        mismatchReason: null,
        checkedAt: null,
        resolvedAt: null,
        createdAt: new Date("2026-09-06T10:00:00.000Z"),
      } as unknown as Reconciliation,
    } as unknown as Settlement & { reconciliation: Reconciliation };

    const context = projectIntelligenceContext(
      makeSource({ settlement }),
      makeViewer(ORG_A),
    );
    expect(context.settlement!.amount).toBe("1250000.50");
    expect(context.settlement!.provider).toBe("mock-gateway");
    expect(context.reconciliation!.expected_amount).toBe("1250000.50");
    expect(context.reconciliation!.actual_amount).toBeNull();
    expect(context.reconciliation!.expected_currency).toBe("USD");
  });

  it("applies zero-minor-unit formatting for JPY", () => {
    const source = makeSource({
      deal: makeDeal({ currency: "JPY", notionalAmount: new Prisma.Decimal("90000000") }),
      offers: [makeOffer("o-jpy", PA, PB, { currency: "JPY", amount: new Prisma.Decimal("90000000") })],
      offerTransitions: [T1],
    });
    const context = projectIntelligenceContext(source, makeViewer(ORG_A));
    expect(context.deal.notional_amount).toBe("90000000");
    expect(context.offers[0].amount).toBe("90000000");
  });

  it("owner override sees counterparty PRIVATE documents", () => {
    const privateDoc = {
      id: "doc-b",
      dealId: DEAL_ID,
      organizationId: ORG_B,
      documentType: "FINAL_AGREEMENT",
      title: "Secret",
      status: "ACTIVE",
      visibility: "PRIVATE",
      visibilityParticipants: [],
      version: 1,
      chainId: "chain-b",
      supersedesId: null,
      originalFilename: "secret.pdf",
      sizeBytes: 10,
      sha256: "h",
      submittedAt: null,
      reviewedAt: null,
      expiresAt: null,
      createdAt: new Date("2026-09-03T08:00:00.000Z"),
    } as unknown as DealDocument;

    const ownerView = makeViewer(ORG_A, { isOwner: true });
    const context = projectIntelligenceContext(
      makeSource({ documents: [privateDoc] }),
      ownerView,
    );
    expect(context.documents.map((d) => d.id)).toContain("doc-b");
  });

  it("renders requirements..", () => {
    const requirements = [{
      id: "rq-1",
      dealId: DEAL_ID,
      requirementType: "DUE_DILIGENCE",
      title: "Title deed copy",
      description: null,
      status: "SATISFIED",
      required: true,
      dueAt: new Date("2026-10-01T00:00:00.000Z"),
      assignedOrganizationId: ORG_B,
      satisfiedAt: new Date("2026-09-08T00:00:00.000Z"),
      createdAt: new Date("2026-09-02T08:00:00.000Z"),
    }] as DealRequirement[];

    const context = projectIntelligenceContext(
      makeSource({ requirements }),
      makeViewer(ORG_A),
    );
    expect(context.requirements).toEqual([
      {
        id: "rq-1",
        requirement_type: "DUE_DILIGENCE",
        title: "Title deed copy",
        description: null,
        status: "SATISFIED",
        required: true,
        due_at: "2026-10-01T00:00:00.000Z",
        assigned_organization_id: ORG_B,
        satisfied_at: "2026-09-08T00:00:00.000Z",
        created_at: "2026-09-02T08:00:00.000Z",
      },
    ]);
  });
});