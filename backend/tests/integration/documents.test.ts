import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { expireEligibleDocuments } from "../../src/modules/documents/document.service.js";
import { expireEligibleRequirements } from "../../src/modules/documents/requirement.service.js";
import { resetDocumentStorage } from "../../src/modules/documents/storage.js";
import { syncSystemRoles } from "../../src/modules/organizations/role.seed.js";
import {
  listDevMailbox,
  clearDevMailbox,
} from "../../src/modules/auth/email.service.js";

// Documents are never stored in the database; pin a scratch bucket for the
// whole suite so the local-disk adapter writes outside the repo.
const tempRoot = mkdtempSync(path.join(tmpdir(), "aegis-doc-test-"));
process.env.DOCUMENT_STORAGE_ROOT = tempRoot;
resetDocumentStorage();

async function isDatabaseReachable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

const dbUp = await isDatabaseReachable();

describe.skipIf(!dbUp)("documents & requirements API (integration)", () => {
  let app: FastifyInstance;

  const emails: string[] = [];
  const orgIds: string[] = [];

  const now = Date.now();
  const uniqueEmail = (prefix: string): string => {
    const email = `it.doc.${prefix}.${now}.${emails.length}@example.com`;
    emails.push(email);
    return email;
  };

  const PASSWORD = "Correct-Horse-2017-Staple!";

  function cookieHeader(res: {
    cookies: Array<{ name: string; value: string }>;
  }): string {
    return res.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  beforeEach(() => clearDevMailbox());

  beforeAll(async () => {
    await syncSystemRoles(prisma);
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await app?.close();
    await prisma.$disconnect();
    resetDocumentStorage();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Fixtures
  // -------------------------------------------------------------------------

  interface Session {
    email: string;
    jar: string;
    csrf: string;
  }

  interface TestDeal {
    id: string;
    version: number;
    status: string;
  }

  async function register(email: string): Promise<void> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email, password: PASSWORD },
    });
    expect(res.statusCode).toBe(201);
  }

  async function verificationTokenFor(email: string): Promise<string> {
    const message = listDevMailbox().find(
      (m) => m.kind === "EMAIL_VERIFICATION" && m.toNormalized === email,
    );
    expect(message).toBeDefined();
    return message!.token;
  }

  async function session(prefix: string): Promise<Session> {
    const email = uniqueEmail(prefix);
    await register(email);
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-email",
      payload: { token: await verificationTokenFor(email) },
    });
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password: PASSWORD },
    });
    expect(loginRes.statusCode).toBe(200);
    return {
      email,
      jar: cookieHeader(loginRes),
      csrf: loginRes.json().csrfToken,
    };
  }

  async function createOrg(owner: Session): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/organizations",
      headers: { cookie: owner.jar, "x-csrf-token": owner.csrf },
      payload: { name: `Doc Test Org ${uniqueEmail("org").split("@")[0]}` },
    });
    expect(res.statusCode).toBe(201);
    const orgId = res.json().organization.id as string;
    orgIds.push(orgId);
    return orgId;
  }

  async function createDeal(actor: Session, orgId: string): Promise<TestDeal> {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${orgId}/deals`,
      headers: { cookie: actor.jar, "x-csrf-token": actor.csrf },
      payload: {
        type: "RWA_PURCHASE",
        name: "Phase 6 documents",
        currency: "USD",
        notionalAmount: "1250000.50",
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().deal as TestDeal;
  }

  /** Invites an org and accepts the invitation as the invitee's session. */
  async function addParticipant(
    owner: Session,
    invitee: Session,
    dealId: string,
    orgId: string,
  ): Promise<void> {
    const invited = await app.inject({
      method: "POST",
      url: `/api/v1/deals/${dealId}/invitations`,
      headers: { cookie: owner.jar, "x-csrf-token": owner.csrf },
      payload: {
        organizationId: orgId,
        email: invitee.email,
        participantType: "COUNTERPARTY",
      },
    });
    expect(invited.statusCode).toBe(201);
    const messages = listDevMailbox().filter(
      (m) =>
        m.kind === "DEAL_PARTICIPANT_INVITATION" &&
        m.toNormalized === invitee.email,
    );
    expect(messages.length).toBeGreaterThan(0);
    const token = messages[messages.length - 1].token;
    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/deal-invitations/${token}/accept`,
      headers: { cookie: invitee.jar, "x-csrf-token": invitee.csrf },
    });
    expect(accepted.statusCode).toBe(201);
  }

  // Real magic-byte fixtures.
  const pdfBytes = Buffer.from(
    "%PDF-1.7\n%%Aegis integration fixture\n%%EOF\n",
  );
  const _pngBytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from("PNG-payload"),
  ]);
  const zipBytes = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from("zip-payload"),
  ]);
  const gifBytes = Buffer.from("GIF89a garbage that claims to be pdf");

  function sha256Hex(value: Buffer): string {
    return createHash("sha256").update(value).digest("hex");
  }

  function createDocument(
    actor: Session,
    dealId: string,
    payload: Record<string, unknown>,
  ) {
    return app.inject({
      method: "POST",
      url: `/api/v1/deals/${dealId}/documents`,
      headers: { cookie: actor.jar, "x-csrf-token": actor.csrf },
      payload,
    });
  }

  function uploadDocument(
    actor: Session,
    dealId: string,
    documentId: string,
    filename: string,
    bytes: Buffer,
  ) {
    return app.inject({
      method: "PUT",
      url: `/api/v1/deals/${dealId}/documents/${documentId}/upload`,
      headers: {
        cookie: actor.jar,
        "x-csrf-token": actor.csrf,
        "content-type": "application/octet-stream",
        "x-original-filename": filename,
        "x-mime-type": "application/octet-stream",
      },
      payload: bytes,
    });
  }

  function documentAction(
    actor: Session,
    dealId: string,
    documentId: string,
    action: "complete" | "submit" | "withdraw" | "review" | "replace",
    payload: Record<string, unknown>,
  ) {
    return app.inject({
      method: "POST",
      url: `/api/v1/deals/${dealId}/documents/${documentId}/${action}`,
      headers: { cookie: actor.jar, "x-csrf-token": actor.csrf },
      payload,
    });
  }

  function getDocument(actor: Session, dealId: string, documentId: string) {
    return app.inject({
      method: "GET",
      url: `/api/v1/deals/${dealId}/documents/${documentId}`,
      headers: { cookie: actor.jar },
    });
  }

  function downloadDocument(
    actor: Session,
    dealId: string,
    documentId: string,
  ) {
    return app.inject({
      method: "GET",
      url: `/api/v1/deals/${dealId}/documents/${documentId}/download`,
      headers: { cookie: actor.jar },
    });
  }

  function createRequirement(
    actor: Session,
    dealId: string,
    payload: Record<string, unknown>,
  ) {
    return app.inject({
      method: "POST",
      url: `/api/v1/deals/${dealId}/requirements`,
      headers: { cookie: actor.jar, "x-csrf-token": actor.csrf },
      payload,
    });
  }

  function requirementAction(
    actor: Session,
    dealId: string,
    requirementId: string,
    action: "submit" | "reject" | "waive" | "reopen" | "satisfy",
    payload: Record<string, unknown>,
  ) {
    return app.inject({
      method: "POST",
      url: `/api/v1/deals/${dealId}/requirements/${requirementId}/${action}`,
      headers: { cookie: actor.jar, "x-csrf-token": actor.csrf },
      payload,
    });
  }

  function attachDocument(
    actor: Session,
    dealId: string,
    requirementId: string,
    documentId: string,
  ) {
    return app.inject({
      method: "POST",
      url: `/api/v1/deals/${dealId}/requirements/${requirementId}/attach`,
      headers: { cookie: actor.jar, "x-csrf-token": actor.csrf },
      payload: { documentId },
    });
  }

  function getRequirement(
    actor: Session,
    dealId: string,
    requirementId: string,
  ) {
    return app.inject({
      method: "GET",
      url: `/api/v1/deals/${dealId}/requirements/${requirementId}`,
      headers: { cookie: actor.jar },
    });
  }

  function listRequirements(actor: Session, dealId: string) {
    return app.inject({
      method: "GET",
      url: `/api/v1/deals/${dealId}/requirements?limit=50`,
      headers: { cookie: actor.jar },
    });
  }

  function readiness(actor: Session, dealId: string) {
    return app.inject({
      method: "GET",
      url: `/api/v1/deals/${dealId}/readiness`,
      headers: { cookie: actor.jar },
    });
  }

  // -------------------------------------------------------------------------
  // Documents API
  // -------------------------------------------------------------------------

  describe("documents API", () => {
    let alice: Session;
    let bob: Session;
    let carol: Session;
    let dave: Session;
    let eve: Session;
    let orgA: string;
    let orgB: string;
    let orgC: string;
    let orgD: string;
    let deal: TestDeal;

    beforeAll(async () => {
      [alice, bob, carol, dave, eve] = await Promise.all([
        session("docs-alice"),
        session("docs-bob"),
        session("docs-carol"),
        session("docs-dave"),
        session("docs-eve"),
      ]);
      [orgA, orgB, orgC, orgD] = await Promise.all([
        createOrg(alice),
        createOrg(bob),
        createOrg(carol),
        createOrg(dave),
      ]);
      deal = await createDeal(alice, orgA);
      // The deal stays DRAFT: documents may be created while still drafting.
      await addParticipant(alice, bob, deal.id, orgB);
      await addParticipant(alice, carol, deal.id, orgC);
      await addParticipant(alice, dave, deal.id, orgD);
      // eve's org stays outside the deal (stranger).
    });

    it("creates a UPLOADING document and refuses bytes from other orgs", async () => {
      const created = await createDocument(bob, deal.id, {
        documentType: "GENERAL",
        title: "Passport scan",
        visibility: "PRIVATE",
        idempotencyKey: "it-doc-create-aaa-0001",
      });
      expect(created.statusCode).toBe(201);
      const doc = created.json().document;
      expect(doc.status).toBe("UPLOADING");
      expect(doc.version).toBe(1);
      expect(doc.chainId).toBe(doc.id);
      expect(doc.hasContent).toBe(false);
      expect(doc.supersedesId).toBeNull();
      expect(doc.expiresAt).toBeTruthy();
      expect(doc.visibleToOrganizationIds).toEqual([]);

      // Even the owner cannot upload on behalf of the uploading org.
      const wrongOrg = await uploadDocument(
        alice,
        deal.id,
        doc.id,
        "sneaky.pdf",
        pdfBytes,
      );
      expect(wrongOrg.statusCode).toBe(403);
      expect(wrongOrg.json().error.code).toBe("DOCUMENT_ACCESS_DENIED");
    });

    it("stores validated bytes exactly once and rejects bad magic/extensions", async () => {
      const created = await createDocument(bob, deal.id, {
        documentType: "GENERAL",
        title: "Upload gate",
        visibility: "PRIVATE",
      });
      const id = created.json().document.id as string;

      // Download before any bytes exist.
      const premature = await downloadDocument(bob, deal.id, id);
      expect(premature.statusCode).toBe(409);
      expect(premature.json().error.code).toBe("DOCUMENT_NOT_READY");

      // Missing extension.
      const noExt = await uploadDocument(
        bob,
        deal.id,
        id,
        "no-extension",
        pdfBytes,
      );
      expect(noExt.statusCode).toBe(400);
      expect(noExt.json().error.code).toBe("DOCUMENT_UPLOAD_INVALID");

      // Extension declares pdf but magic bytes are GIF.
      const badMagic = await uploadDocument(
        bob,
        deal.id,
        id,
        "scan.pdf",
        gifBytes,
      );
      expect(badMagic.statusCode).toBe(400);
      expect(badMagic.json().error.code).toBe("DOCUMENT_UPLOAD_INVALID");

      // A valid upload records the sha256 + size for later integrity checks.
      const uploaded = await uploadDocument(
        bob,
        deal.id,
        id,
        "scan.pdf",
        pdfBytes,
      );
      expect(uploaded.statusCode).toBe(200);
      const stored = uploaded.json().document;
      expect(stored.hasContent).toBe(true);
      expect(stored.originalFilename).toBe("scan.pdf");
      expect(stored.contentType).toBe("application/pdf");
      expect(stored.sizeBytes).toBe(pdfBytes.length);
      expect(stored.sha256).toBe(sha256Hex(pdfBytes));

      // A second PUT is refused: the claim was already taken.
      const double = await uploadDocument(
        bob,
        deal.id,
        id,
        "other.pdf",
        pdfBytes,
      );
      expect(double.statusCode).toBe(400);
      expect(double.json().error.code).toBe("DOCUMENT_UPLOAD_INVALID");

      // A KYC_PASSPORT cannot carry a .docx (extensions not permitted).
      const kyc = await createDocument(bob, deal.id, {
        documentType: "KYC_PASSPORT",
        title: "Passport (KYC)",
        visibility: "PRIVATE",
      });
      const kycId = kyc.json().document.id as string;
      const wrongType = await uploadDocument(
        bob,
        deal.id,
        kycId,
        "passport.docx",
        zipBytes,
      );
      expect(wrongType.statusCode).toBe(400);
      expect(wrongType.json().error.code).toBe("DOCUMENT_TYPE_NOT_ALLOWED");

      const kycUpload = await uploadDocument(
        bob,
        deal.id,
        kycId,
        "passport.pdf",
        pdfBytes,
      );
      expect(kycUpload.statusCode).toBe(200);
      expect(kycUpload.json().document.documentType).toBe("KYC_PASSPORT");
    });

    it("completes and submits idempotently, then the owner rejects", async () => {
      const created = await createDocument(bob, deal.id, {
        documentType: "GENERAL",
        title: "Audited financials",
        visibility: "PRIVATE",
      });
      const id = created.json().document.id as string;
      await uploadDocument(bob, deal.id, id, "audited.pdf", pdfBytes);

      const completed = await documentAction(bob, deal.id, id, "complete", {
        requestId: "it-doc-complete-aaa-0002",
      });
      expect(completed.statusCode).toBe(200);
      expect(completed.json().document.status).toBe("UPLOADED");
      expect(completed.json().transition.transitionType).toBe(
        "DOCUMENT_UPLOADED",
      );
      expect(completed.json().replay).toBe(false);

      // Complete is state-level idempotent (status already UPLOADED).
      const completeAgain = await documentAction(bob, deal.id, id, "complete", {
        requestId: "it-doc-complete-aaa-0003",
      });
      expect(completeAgain.statusCode).toBe(200);
      expect(completeAgain.json().replay).toBe(true);
      expect(completeAgain.json().document.status).toBe("UPLOADED");

      const submitted = await documentAction(bob, deal.id, id, "submit", {
        requestId: "it-doc-submit-aaa-0002",
      });
      expect(submitted.statusCode).toBe(200);
      expect(submitted.json().document.status).toBe("SUBMITTED");
      expect(submitted.json().document.submittedAt).toBeTruthy();
      expect(submitted.json().transition.transitionType).toBe(
        "DOCUMENT_SUBMITTED",
      );

      // Re-submitting without a replayable requestId is refused.
      const resubmit = await documentAction(bob, deal.id, id, "submit", {
        requestId: "it-doc-submit-aaa-0009",
      });
      expect(resubmit.statusCode).toBe(409);
      expect(resubmit.json().error.code).toBe("DOCUMENT_ALREADY_SUBMITTED");

      // The same requestId replays the original submission.
      const replay = await documentAction(bob, deal.id, id, "submit", {
        requestId: "it-doc-submit-aaa-0002",
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().replay).toBe(true);
      expect(replay.json().document.status).toBe("SUBMITTED");

      // Only the owner can review.
      const notOwner = await documentAction(bob, deal.id, id, "review", {
        decision: "ACCEPT",
        requestId: "it-doc-review-aaa-0001",
      });
      expect(notOwner.statusCode).toBe(403);

      const rejected = await documentAction(alice, deal.id, id, "review", {
        decision: "REJECT",
        comment: "Missing a supporting cover letter.",
        requestId: "it-doc-review-aaa-0002",
      });
      expect(rejected.statusCode).toBe(200);
      expect(rejected.json().document.status).toBe("REJECTED");
      expect(rejected.json().document.reviewerUserId).toBeTruthy();
      expect(rejected.json().document.reviewComment).toContain("cover letter");

      // REJECTED is terminal for review.
      const acceptAfterReject = await documentAction(
        alice,
        deal.id,
        id,
        "review",
        {
          decision: "ACCEPT",
          comment: "Fine now.",
          requestId: "it-doc-review-aaa-0003",
        },
      );
      expect(acceptAfterReject.statusCode).toBe(409);
      expect(acceptAfterReject.json().error.code).toBe(
        "DOCUMENT_INVALID_TRANSITION",
      );
    });

    it("accepts a submission and records the reviewer + acceptance window", async () => {
      const created = await createDocument(bob, deal.id, {
        documentType: "CONTRACT",
        title: "Master agreement",
        visibility: "PRIVATE",
      });
      const id = created.json().document.id as string;
      await uploadDocument(bob, deal.id, id, "master.pdf", pdfBytes);
      await documentAction(bob, deal.id, id, "complete", {
        requestId: `c-${id}`.slice(0, 64),
      });

      const submitted = await documentAction(bob, deal.id, id, "submit", {
        requestId: `s-${id}`.slice(0, 64),
      });
      expect(submitted.statusCode).toBe(200);

      const accepted = await documentAction(alice, deal.id, id, "review", {
        decision: "ACCEPT",
        comment: "Accepted as-is.",
        requestId: `a-${id}`.slice(0, 64),
      });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json().document.status).toBe("ACCEPTED");
      expect(accepted.json().document.reviewerUserId).toBeTruthy();
      expect(accepted.json().document.expiresAt).toBeTruthy();
      expect(accepted.json().transition.transitionType).toBe(
        "DOCUMENT_ACCEPTED",
      );
    });

    it("withdraws UPLOADED/SUBMITTED documents and refuses terminal moves", async () => {
      const created = await createDocument(bob, deal.id, {
        documentType: "GENERAL",
        title: "Draft to pull",
        visibility: "PRIVATE",
      });
      const id = created.json().document.id as string;
      await uploadDocument(bob, deal.id, id, "draft.pdf", pdfBytes);
      await documentAction(bob, deal.id, id, "complete", {
        requestId: `wc-${id}`.slice(0, 64),
      });

      const withdrawn = await documentAction(bob, deal.id, id, "withdraw", {
        requestId: `w-${id}`.slice(0, 64),
      });
      expect(withdrawn.statusCode).toBe(200);
      expect(withdrawn.json().document.status).toBe("WITHDRAWN");
      expect(withdrawn.json().document.expiresAt).toBeNull();

      // WITHDRAWN is terminal.
      const submitAfterWithdraw = await documentAction(
        bob,
        deal.id,
        id,
        "submit",
        {
          requestId: `ws-${id}`.slice(0, 64),
        },
      );
      expect(submitAfterWithdraw.statusCode).toBe(409);
      expect(submitAfterWithdraw.json().error.code).toBe(
        "DOCUMENT_INVALID_TRANSITION",
      );

      // Same requestId replays idempotently.
      const replay = await documentAction(bob, deal.id, id, "withdraw", {
        requestId: `w-${id}`.slice(0, 64),
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().replay).toBe(true);
    });

    it("replaces a submitted document and supersedes the parent on completion", async () => {
      const created = await createDocument(bob, deal.id, {
        documentType: "GENERAL",
        title: "Vendor contract v1",
        visibility: "PRIVATE",
        idempotencyKey: "it-doc-replace-aaa-0005",
      });
      const v1 = created.json().document;
      expect(v1.version).toBe(1);
      await uploadDocument(bob, deal.id, v1.id, "contract.pdf", pdfBytes);
      await documentAction(bob, deal.id, v1.id, "complete", {
        requestId: `c1-${v1.id}`.slice(0, 64),
      });
      await documentAction(bob, deal.id, v1.id, "submit", {
        requestId: `s1-${v1.id}`.slice(0, 64),
      });

      const replaced = await documentAction(bob, deal.id, v1.id, "replace", {
        title: "Vendor contract v2",
        requestId: "it-doc-replace-req-0005",
        idempotencyKey: "it-doc-replace-child-0005",
      });
      expect(replaced.statusCode).toBe(201);
      const v2 = replaced.json().document;
      expect(v2.version).toBe(2);
      expect(v2.chainId).toBe(v1.chainId);
      expect(v2.supersedesId).toBe(v1.id);
      expect(v2.status).toBe("UPLOADING");

      // One in-flight replacement per chain.
      const secondFork = await documentAction(bob, deal.id, v1.id, "replace", {
        requestId: "it-doc-replace-req-0006",
      });
      expect(secondFork.statusCode).toBe(409);
      expect(secondFork.json().error.code).toBe("DOCUMENT_VERSION_CONFLICT");

      // The in-flight child cannot itself be replaced until it is live.
      const replaceChild = await documentAction(
        bob,
        deal.id,
        v2.id,
        "replace",
        {
          requestId: "it-doc-replace-req-0007",
        },
      );
      expect(replaceChild.statusCode).toBe(409);
      expect(replaceChild.json().error.code).toBe("DOCUMENT_INVALID_STATE");

      await uploadDocument(bob, deal.id, v2.id, "contract-v2.pdf", pdfBytes);
      const v2Complete = await documentAction(bob, deal.id, v2.id, "complete", {
        requestId: `c2-${v2.id}`.slice(0, 64),
      });
      expect(v2Complete.statusCode).toBe(200);
      expect(v2Complete.json().document.status).toBe("UPLOADED");

      // Parent is SUPERSEDED with an explicit transition.
      const v1After = await getDocument(bob, deal.id, v1.id);
      expect(v1After.json().document.status).toBe("SUPERSEDED");

      // Both versions are listed; historical bytes remain downloadable.
      const versions = await app.inject({
        method: "GET",
        url: `/api/v1/deals/${deal.id}/documents/${v1.id}/versions`,
        headers: { cookie: bob.jar },
      });
      expect(versions.json().chainId).toBe(v1.chainId);
      const versionRows = versions.json().versions;
      expect(versionRows.map((d: { version: number }) => d.version)).toEqual([
        1, 2,
      ]);

      const dlV2 = await downloadDocument(bob, deal.id, v2.id);
      expect(dlV2.statusCode).toBe(200);
      expect(dlV2.rawPayload.equals(pdfBytes)).toBe(true);
      const dlV1 = await downloadDocument(bob, deal.id, v1.id);
      expect(dlV1.statusCode).toBe(200);
      expect(dlV1.rawPayload.equals(pdfBytes)).toBe(true);
    });

    it("scopes every document to its visibility window", async () => {
      const hidden = await createDocument(bob, deal.id, {
        documentType: "GENERAL",
        title: "Bob PRIVATE",
        visibility: "PRIVATE",
      });
      const hiddenId = hidden.json().document.id as string;
      await uploadDocument(bob, deal.id, hiddenId, "private.pdf", pdfBytes);
      await documentAction(bob, deal.id, hiddenId, "complete", {
        requestId: `hc-${hiddenId}`.slice(0, 64),
      });

      const shared = await createDocument(bob, deal.id, {
        documentType: "GENERAL",
        title: "Bob PARTICIPANTS",
        visibility: "PARTICIPANTS",
      });
      const sharedId = shared.json().document.id as string;
      await uploadDocument(bob, deal.id, sharedId, "shared.pdf", pdfBytes);
      await documentAction(bob, deal.id, sharedId, "complete", {
        requestId: `sc-${sharedId}`.slice(0, 64),
      });

      const ownerOnly = await createDocument(bob, deal.id, {
        documentType: "GENERAL",
        title: "Bob for owner only",
        visibility: "DEAL_OWNER",
      });
      const ownerId = ownerOnly.json().document.id as string;
      await uploadDocument(bob, deal.id, ownerId, "owner.pdf", pdfBytes);
      await documentAction(bob, deal.id, ownerId, "complete", {
        requestId: `oc-${ownerId}`.slice(0, 64),
      });

      const specific = await createDocument(bob, deal.id, {
        documentType: "GENERAL",
        title: "Bob → Carol",
        visibility: "SPECIFIC_PARTICIPANTS",
        visibleToOrganizationIds: [orgC],
      });
      const specificId = specific.json().document.id as string;
      expect(specific.json().document.visibleToOrganizationIds).toEqual([orgC]);
      await uploadDocument(bob, deal.id, specificId, "targeted.pdf", pdfBytes);
      await documentAction(bob, deal.id, specificId, "complete", {
        requestId: `tc-${specificId}`.slice(0, 64),
      });

      // Owner sees absolutely everything.
      const ownerList = await app.inject({
        method: "GET",
        url: `/api/v1/deals/${deal.id}/documents?limit=50`,
        headers: { cookie: alice.jar },
      });
      const ownerTitles = ownerList
        .json()
        .documents.map((d: { title: string }) => d.title);
      expect(ownerTitles).toContain("Bob PRIVATE");
      expect(ownerTitles).toContain("Bob PARTICIPANTS");
      expect(ownerTitles).toContain("Bob for owner only");
      expect(ownerTitles).toContain("Bob → Carol");

      // Carol sees PARTICIPANTS + the document specifically granted to her.
      const carolList = await app.inject({
        method: "GET",
        url: `/api/v1/deals/${deal.id}/documents?limit=50`,
        headers: { cookie: carol.jar },
      });
      const carolTitles = carolList
        .json()
        .documents.map((d: { title: string }) => d.title);
      expect(carolTitles).toContain("Bob PARTICIPANTS");
      expect(carolTitles).toContain("Bob → Carol");
      expect(carolTitles).not.toContain("Bob PRIVATE");
      expect(carolTitles).not.toContain("Bob for owner only");

      // Carol cannot see PRIVATE or DEAL_OWNER content (identical 404s).
      const hiddenPeek = await getDocument(carol, deal.id, hiddenId);
      expect(hiddenPeek.statusCode).toBe(404);
      expect(hiddenPeek.json().error.code).toBe("DOCUMENT_NOT_FOUND");
      const hiddenDl = await downloadDocument(carol, deal.id, hiddenId);
      expect(hiddenDl.statusCode).toBe(404);
      const ownerPeek = await getDocument(carol, deal.id, ownerId);
      expect(ownerPeek.statusCode).toBe(404);

      // Carol CAN download the granted + shared docs.
      const sharedDl = await downloadDocument(carol, deal.id, sharedId);
      expect(sharedDl.statusCode).toBe(200);
      expect(sharedDl.headers["content-type"]).toBe("application/pdf");
      expect(sharedDl.headers["content-disposition"]).toContain("shared.pdf");
      expect(sharedDl.rawPayload.equals(pdfBytes)).toBe(true);

      // Dave (a participant outside the grant) only sees PARTICIPANTS docs.
      const daveList = await app.inject({
        method: "GET",
        url: `/api/v1/deals/${deal.id}/documents?limit=50`,
        headers: { cookie: dave.jar },
      });
      expect(daveList.json().total).toBe(1);
      const specificPeek = await getDocument(dave, deal.id, specificId);
      expect(specificPeek.statusCode).toBe(404);
    });

    it("keeps the room confidential and enforces authn + CSRF", async () => {
      // Anonymous.
      const anonymous = await app.inject({
        method: "GET",
        url: `/api/v1/deals/${deal.id}/documents`,
      });
      expect(anonymous.statusCode).toBe(401);

      // A stranger to the deal gets the same 404 as a bad deal id.
      const strangerList = await app.inject({
        method: "GET",
        url: `/api/v1/deals/${deal.id}/documents`,
        headers: { cookie: eve.jar },
      });
      expect(strangerList.statusCode).toBe(404);
      expect(strangerList.json().error.code).toBe("DEAL_PARTICIPANT_NOT_FOUND");

      // Missing CSRF on a state-changing call is refused.
      const noCsrf = await app.inject({
        method: "POST",
        url: `/api/v1/deals/${deal.id}/documents`,
        headers: { cookie: bob.jar },
        payload: { documentType: "GENERAL", title: "No csrf" },
      });
      expect(noCsrf.statusCode).toBe(403);
    });

    it("replays create idempotency keys and forbids key reuse", async () => {
      const payload = {
        documentType: "GENERAL",
        title: "Idempotent doc",
        visibility: "PRIVATE",
        idempotencyKey: "it-doc-idem-aaa-0008",
      };
      const first = await createDocument(bob, deal.id, payload);
      expect(first.statusCode).toBe(201);
      const second = await createDocument(bob, deal.id, payload);
      expect(second.statusCode).toBe(201);
      expect(second.json().document.id).toBe(first.json().document.id);

      const conflicting = await createDocument(bob, deal.id, {
        ...payload,
        title: "Different title",
      });
      expect(conflicting.statusCode).toBe(409);
      expect(conflicting.json().error.code).toBe("DEAL_IDEMPOTENCY_CONFLICT");
    });

    it("expires documents whose window passed (lazy + worker)", async () => {
      const created = await createDocument(bob, deal.id, {
        documentType: "GENERAL",
        title: "Expired window",
        visibility: "PRIVATE",
      });
      const id = created.json().document.id as string;

      // Backdate the window; uploading then lazily expires it.
      await prisma.dealDocument.update({
        where: { id },
        data: { expiresAt: new Date(Date.now() - 5000) },
      });
      const expired = await uploadDocument(
        bob,
        deal.id,
        id,
        "late.pdf",
        pdfBytes,
      );
      expect(expired.statusCode).toBe(409);
      expect(expired.json().error.code).toBe("DOCUMENT_EXPIRED");

      // The worker expires an UPLOADED row whose window passed.
      const created2 = await createDocument(bob, deal.id, {
        documentType: "GENERAL",
        title: "Never completed",
        visibility: "PRIVATE",
      });
      const id2 = created2.json().document.id as string;
      await uploadDocument(bob, deal.id, id2, "orphan.pdf", pdfBytes);
      await prisma.dealDocument.update({
        where: { id: id2 },
        data: { expiresAt: new Date(Date.now() - 5000) },
      });
      const expiredCount = await expireEligibleDocuments(
        new Date(Date.now() + 60 * 1000),
      );
      expect(expiredCount).toBeGreaterThanOrEqual(1);
      const after = await getDocument(bob, deal.id, id2);
      expect(after.json().document.status).toBe("EXPIRED");
    });

    it("writes an audit trail for document activity", async () => {
      // Fully drive a document through the lifecycle so the assertions do not
      // depend on which earlier test ran (or aborted) first.
      const created = await createDocument(bob, deal.id, {
        documentType: "GENERAL",
        title: "Audit fixture",
        visibility: "PRIVATE",
      });
      const id = created.json().document.id as string;
      await uploadDocument(bob, deal.id, id, "audit.pdf", pdfBytes);
      await documentAction(bob, deal.id, id, "complete", {
        requestId: `audit-c-${id}`.slice(0, 64),
      });
      await documentAction(bob, deal.id, id, "submit", {
        requestId: `audit-s-${id}`.slice(0, 64),
      });
      await documentAction(alice, deal.id, id, "review", {
        decision: "ACCEPT",
        comment: "Audited.",
        requestId: `audit-a-${id}`.slice(0, 64),
      });
      await downloadDocument(alice, deal.id, id);

      const uploads = await prisma.securityEvent.findMany({
        where: { organizationId: orgB, type: "DOCUMENT_UPLOADED" },
      });
      expect(uploads.length).toBeGreaterThanOrEqual(1);
      const downloads = await prisma.securityEvent.findMany({
        where: { organizationId: orgA, type: "DOCUMENT_DOWNLOAD_REQUESTED" },
      });
      expect(downloads.length).toBeGreaterThanOrEqual(1);
      const accepted = await prisma.securityEvent.findMany({
        where: { organizationId: orgA, type: "DOCUMENT_ACCEPTED" },
      });
      expect(accepted.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // Requirements API & deal readiness
  // -------------------------------------------------------------------------

  describe("requirements API", () => {
    let alice: Session;
    let bob: Session;
    let carol: Session;
    let orgA: string;
    let orgB: string;
    let orgC: string;
    let deal: TestDeal;
    let supportDoc: { id: string; chainId: string };
    let documentRequirementId: string;

    beforeAll(async () => {
      [alice, bob, carol] = await Promise.all([
        session("req-alice"),
        session("req-bob"),
        session("req-carol"),
      ]);
      [orgA, orgB, orgC] = await Promise.all([
        createOrg(alice),
        createOrg(bob),
        createOrg(carol),
      ]);
      deal = await createDeal(alice, orgA);
      await addParticipant(alice, bob, deal.id, orgB);
      await addParticipant(alice, carol, deal.id, orgC);

      // A fully-accepted supporting document, ready to attach.
      const created = await createDocument(bob, deal.id, {
        documentType: "GENERAL",
        title: "Supporting evidence",
        visibility: "PRIVATE",
      });
      const docId = created.json().document.id as string;
      supportDoc = { id: docId, chainId: created.json().document.chainId };
      await uploadDocument(bob, deal.id, docId, "support.pdf", pdfBytes);
      await documentAction(bob, deal.id, docId, "complete", {
        requestId: "req-support-complete-0001",
      });
      await documentAction(bob, deal.id, docId, "submit", {
        requestId: "req-support-submit-0001",
      });
      const accepted = await documentAction(alice, deal.id, docId, "review", {
        decision: "ACCEPT",
        comment: "Supporting evidence accepted.",
        requestId: "req-support-accept-0001",
      });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json().document.status).toBe("ACCEPTED");
    });

    it("creates requirements the owner can see and the assignee can act on", async () => {
      const created = await createRequirement(alice, deal.id, {
        requirementType: "DOCUMENT",
        title: "Provide audited support",
        description: "Upload your audited financials.",
        assignedOrganizationId: orgB,
        required: true,
        idempotencyKey: "it-requirement-create-aaa-0001",
      });
      expect(created.statusCode).toBe(201);
      documentRequirementId = created.json().requirement.id as string;
      expect(created.json().requirement.status).toBe("OPEN");
      expect(created.json().requirement.assignedOrganizationId).toBe(orgB);
      expect(created.json().requirement.documentGroups).toEqual([]);

      // A non-participant org cannot be assigned.
      const badAssign = await createRequirement(alice, deal.id, {
        requirementType: "INFORMATION",
        title: "To nowhere",
        assignedOrganizationId: "00000000-0000-4000-8000-000000000000",
      });
      expect(badAssign.statusCode).toBe(403);
      expect(badAssign.json().error.code).toBe("REQUIREMENT_NOT_ASSIGNED");

      // Only the owner can create requirements.
      const notOwner = await createRequirement(bob, deal.id, {
        requirementType: "INFORMATION",
        title: "Bob oversteps",
      });
      expect(notOwner.statusCode).toBe(403);

      // Carol (a participant, not the assignee) sees nothing about it.
      const carolGet = await getRequirement(
        carol,
        deal.id,
        documentRequirementId,
      );
      expect(carolGet.statusCode).toBe(404);
      expect(carolGet.json().error.code).toBe("REQUIREMENT_NOT_FOUND");
      const carolList = await listRequirements(carol, deal.id);
      expect(carolList.json().total).toBe(0);

      // The assignee sees it and can read it.
      const bobList = await listRequirements(bob, deal.id);
      expect(bobList.json().total).toBe(1);
      const bobGet = await getRequirement(bob, deal.id, documentRequirementId);
      expect(bobGet.statusCode).toBe(200);
      expect(bobGet.json().requirement.status).toBe("OPEN");
    });

    it("runs reject → reopen → attach → submit → satisfy for document evidence", async () => {
      // Assignee submits without a document attached.
      const submitted = await requirementAction(
        bob,
        deal.id,
        documentRequirementId,
        "submit",
        { requestId: "it-requirement-submit-aaa-0001" },
      );
      expect(submitted.statusCode).toBe(200);
      expect(submitted.json().requirement.status).toBe("SUBMITTED");
      expect(submitted.json().transition.transitionType).toBe(
        "REQUIREMENT_SUBMITTED",
      );

      // Owning org cannot satisfy a DOCUMENT requirement with no attached proof.
      const noProof = await requirementAction(
        alice,
        deal.id,
        documentRequirementId,
        "satisfy",
        { requestId: "it-requirement-satisfy-aaa-0001" },
      );
      expect(noProof.statusCode).toBe(400);
      expect(noProof.json().error.code).toBe("REQUIREMENT_DOCUMENT_INVALID");

      // Owner rejects with a reason.
      const rejected = await requirementAction(
        alice,
        deal.id,
        documentRequirementId,
        "reject",
        {
          reason: "Attach the supporting evidence first.",
          requestId: "it-requirement-reject-aaa-0001",
        },
      );
      expect(rejected.statusCode).toBe(200);
      expect(rejected.json().requirement.status).toBe("REJECTED");
      expect(rejected.json().requirement.rejectionReason).toContain("first");

      // Owner reopens; the cycle can continue.
      const reopened = await requirementAction(
        alice,
        deal.id,
        documentRequirementId,
        "reopen",
        { requestId: "it-requirement-reopen-aaa-0001" },
      );
      expect(reopened.statusCode).toBe(200);
      expect(reopened.json().requirement.status).toBe("OPEN");
      expect(reopened.json().transition.transitionType).toBe(
        "REQUIREMENT_OPEN",
      );

      // Assignee attaches the accepted evidence.
      const attached = await attachDocument(
        bob,
        deal.id,
        documentRequirementId,
        supportDoc.id,
      );
      expect(attached.statusCode).toBe(200);
      expect(attached.json().requirement.documentGroups).toContain(
        supportDoc.chainId,
      );
      // Re-attaching the same chain is idempotent.
      const reattached = await attachDocument(
        bob,
        deal.id,
        documentRequirementId,
        supportDoc.id,
      );
      expect(reattached.json().requirement.documentGroups).toContain(
        supportDoc.chainId,
      );

      // Carrying the original requestId submits idempotently.
      const resubmitted = await requirementAction(
        bob,
        deal.id,
        documentRequirementId,
        "submit",
        { requestId: "it-requirement-submit-aaa-0001" },
      );
      expect(resubmitted.statusCode).toBe(200);
      expect(resubmitted.json().replay).toBe(true);

      const resubmitted2 = await requirementAction(
        bob,
        deal.id,
        documentRequirementId,
        "submit",
        { requestId: "it-requirement-submit-aaa-0002" },
      );
      expect(resubmitted2.json().requirement.status).toBe("SUBMITTED");

      // Now the owner can satisfy it.
      const satisfiedReq = await requirementAction(
        alice,
        deal.id,
        documentRequirementId,
        "satisfy",
        {
          comment: "Verified against the ledger.",
          requestId: "it-requirement-satisfy-aaa-0002",
        },
      );
      expect(satisfiedReq.statusCode).toBe(200);
      expect(satisfiedReq.json().requirement.status).toBe("SATISFIED");
      expect(satisfiedReq.json().requirement.satisfiedAt).toBeTruthy();

      // A non-owner cannot satisfy.
      const bobSatisfy = await requirementAction(
        bob,
        deal.id,
        documentRequirementId,
        "satisfy",
        { requestId: "it-requirement-satisfy-aaa-0003" },
      );
      expect(bobSatisfy.statusCode).toBe(403);

      // A non-assignee cannot submit (they cannot even see it).
      const carolSubmit = await requirementAction(
        carol,
        deal.id,
        documentRequirementId,
        "submit",
        { requestId: "it-requirement-submit-aaa-0009" },
      );
      expect(carolSubmit.statusCode).toBe(404);
      expect(carolSubmit.json().error.code).toBe("REQUIREMENT_NOT_FOUND");
    });

    it("reports deal readiness to the owner only", async () => {
      const nonOwner = await readiness(carol, deal.id);
      expect(nonOwner.statusCode).toBe(403);

      const snapshot = await readiness(alice, deal.id);
      expect(snapshot.statusCode).toBe(200);
      expect(snapshot.json().readiness.dealId).toBe(deal.id);
      expect(snapshot.json().readiness.required).toBe(1);
      expect(snapshot.json().readiness.outstanding).toBe(0);
      expect(snapshot.json().readiness.blocked).toBe(false);
      const req = snapshot
        .json()
        .readiness.requirements.find(
          (r: { id: string }) => r.id === documentRequirementId,
        );
      expect(req.satisfied).toBe(true);
      expect(req.status).toBe("SATISFIED");
    });

    it("waives and expires requirements, excluding them from scope", async () => {
      // Waive an OPEN requirement.
      const toWaive = await createRequirement(alice, deal.id, {
        requirementType: "INFORMATION",
        title: "Board approval (waivable)",
        assignedOrganizationId: orgB,
        required: true,
      });
      const waived = await requirementAction(
        alice,
        deal.id,
        toWaive.json().requirement.id as string,
        "waive",
        {
          reason: "No longer required.",
          requestId: "it-requirement-waive-aaa-0001",
        },
      );
      expect(waived.statusCode).toBe(200);
      expect(waived.json().requirement.status).toBe("WAIVED");
      expect(waived.json().requirement.waivedAt).toBeTruthy();

      // Expire a requirement whose dueAt passed (worker path).
      const toExpire = await createRequirement(alice, deal.id, {
        requirementType: "CONFIRMATION",
        title: "Confirm details",
        assignedOrganizationId: orgB,
        required: true,
        dueAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
      const expireId = toExpire.json().requirement.id as string;
      await prisma.dealRequirement.update({
        where: { id: expireId },
        data: { dueAt: new Date(Date.now() - 5000) },
      });
      const expiredCount = await expireEligibleRequirements(
        new Date(Date.now() + 60 * 1000),
      );
      expect(expiredCount).toBeGreaterThanOrEqual(1);
      const expiredReq = await getRequirement(alice, deal.id, expireId);
      expect(expiredReq.json().requirement.status).toBe("EXPIRED");

      // Terminal: submit on an expired requirement is refused.
      const refused = await requirementAction(
        bob,
        deal.id,
        expireId,
        "submit",
        { requestId: "it-requirement-submit-aaa-0099" },
      );
      expect(refused.statusCode).toBe(409);

      // WAIVED/EXPIRED requirements leave the blocking scope.
      const snapshot = await readiness(alice, deal.id);
      expect(snapshot.json().readiness.blocked).toBe(false);
    });

    it("re-blocks readiness when supporting evidence expires", async () => {
      // Expire the accepted evidence the satisfied requirement depends on.
      await prisma.dealDocument.update({
        where: { id: supportDoc.id },
        data: { expiresAt: new Date(Date.now() - 5000) },
      });
      const expiredCount = await expireEligibleDocuments(
        new Date(Date.now() + 60 * 1000),
      );
      expect(expiredCount).toBeGreaterThanOrEqual(1);

      const evidence = await getDocument(bob, deal.id, supportDoc.id);
      expect(evidence.json().document.status).toBe("EXPIRED");

      // Readiness now reflects that the satisfied requirement is no longer satisfied.
      const snapshot = await readiness(alice, deal.id);
      expect(snapshot.json().readiness.blocked).toBe(true);
      const req = snapshot
        .json()
        .readiness.requirements.find(
          (r: { id: string }) => r.id === documentRequirementId,
        );
      expect(req.status).toBe("SATISFIED");
      expect(req.satisfied).toBe(false);
    });

    it("writes an audit trail for requirements", async () => {
      const satisfied = await prisma.securityEvent.findMany({
        where: { organizationId: orgA, type: "REQUIREMENT_SATISFIED" },
      });
      expect(satisfied.length).toBeGreaterThanOrEqual(1);
      const waives = await prisma.securityEvent.findMany({
        where: { organizationId: orgA, type: "REQUIREMENT_WAIVED" },
      });
      expect(waives.length).toBeGreaterThanOrEqual(1);
      const opens = await prisma.securityEvent.findMany({
        where: { organizationId: orgA, type: "REQUIREMENT_REOPENED" },
      });
      expect(opens.length).toBeGreaterThanOrEqual(1);
    });
  });
});
